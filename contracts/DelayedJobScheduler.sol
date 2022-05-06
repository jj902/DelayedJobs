//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Address.sol";

/**
 *  @author Jeremy Jin
 *  @title DelayedJobScheduler
 *  @notice DelayedJobScheduler provides a service where people schedule
 *  delayed job with prize and winning bidder can get reward on execution.
 *  @dev Here's the workflow:
 *
 *  Rather than wait and check who is winner after delay, it determines the
 *  winner on the fly when there's a new bid.
 *  Meaning that when there's lower bidder, it'll be winner immediately, and
 *  refund previous deposited amount to the previous winner.
 *  Later on, if winner execute the job, it'll send all the money
 *  (reward + collateral = Maximum Reward) to him.
 *  If job is not executed, creator can withdraw all deposited money,
 *  and mark it as cancelled.
 */
contract DelayedJobScheduler {
    using Address for address;

    // Status of Job
    enum Status {
        PENDING,
        CANCELLED,
        EXECUTED
    }

    struct Job {
        address payable contractAddress;
        string methodAbi;
        address creatorAddress;
        uint256 createdAt;
        uint256 delay;
        uint256 timeout;
        uint256 maximumReward;
        uint256 winningBidAmount;
        address payable winningBidderAddress;
        Status status;
    }

    // Mapping from job ID to job
    mapping(uint256 => Job) public jobs;

    // Length of jobs mapping.
    uint256 public jobNumber;

    event JobCreated(
        uint256 jobID,
        address contractAddress,
        string methodAbi,
        uint256 delay,
        uint256 timeout,
        uint256 maximumReward
    );
    event NewWinner(uint256 jobID, address winnerAddress, uint256 bidAmount);
    event JobExecuted(uint256 jobID);
    event TransferFailed(address target, uint256 amount);
    event Withdraw(uint256 jobId, uint256 amount);

    /*
     *  @dev This checks if jobId is in valid range
     *  @param jobId ID of Job.
     */
    modifier validJobID(uint256 jobId) {
        require(jobId > 0 && jobId <= jobNumber, "Job Index is out of range.");
        _;
    }

    /*
     *  @dev This checks if job with that id is in PENDING status.
     *  If status is CANCELLED or EXECUTED, bidding and executing job shouldn't be allowed.
     *  @param jobId ID of Job.
     */
    modifier pendingJob(uint256 jobId) {
        require(
            jobs[jobId].status == Status.PENDING,
            "Already Executed or Cancelled"
        );
        _;
    }

    /*
     *  @notice With this, any user can schedule a job which will give reward to winning bidder.
     *  In order to schedule a job, user should deposit ether as specified in maximumReward.
     *  @dev It checks if all inputs are valid, and create a new job.
     *  @param contractAddress The address of contract which will be called by bidder.
     *  @param mothodAbi The string format of function in contract which will be called by bidder.
     *  @param delay The Amount of time(in seconds) that accept bidders after it's created.
     *  @param timeout The Amount of time(in seconds) that winning bidder can execute the job.
     *  @param maximumReward The Maximum amount of ether that creator will give winning bidder as a reward.
     */
    function createJob(
        address contractAddress,
        string memory methodAbi,
        uint256 delay,
        uint256 timeout,
        uint256 maximumReward
    ) public payable {
        require(contractAddress.isContract(), "Invalid Contract Address");
        require(delay > 0 && timeout > 0, "Invalid delay or timeout");
        require(maximumReward > 0, "Invalid Maximum Reward");
        require(maximumReward == msg.value, "Invalid Deposit Amount");

        // Create a new job
        Job memory job = Job({
            contractAddress: payable(contractAddress),
            methodAbi: methodAbi,
            delay: delay,
            timeout: timeout,
            maximumReward: maximumReward,
            status: Status.PENDING,
            createdAt: block.timestamp,
            creatorAddress: msg.sender,
            winningBidAmount: maximumReward,
            winningBidderAddress: payable(address(0))
        });

        // Increase the job number
        jobNumber += 1;

        // Add a new job record
        jobs[jobNumber] = job;

        // Trigger the event
        emit JobCreated(
            jobNumber,
            job.contractAddress,
            job.methodAbi,
            job.delay,
            job.timeout,
            job.maximumReward
        );
    }

    /*
     *  @notice With this, bidders can bid to the job with proposed bid amount.
     *  @dev It checks if job is in valid status, checks collateral bidder submit,
     *  and determine new winner, refund to the previous winner, and refund
     *  offset(previous winning bid amount - new winning bid amount) to the creator.
     *  @param jobId ID of job
     *  @param bidAmount Amount of Ether proposed by bidder.
     */
    function bidJob(uint256 jobId, uint256 bidAmount)
        public
        payable
        validJobID(jobId)
        pendingJob(jobId)
    {
        Job storage job = jobs[jobId];

        // Check Job Expiration
        require(block.timestamp < job.delay + job.createdAt, "Job Expired");

        // Bid Amount Check
        require(
            bidAmount > 0 && bidAmount <= job.maximumReward,
            "Invalid Bid Amount"
        );

        // Collateral Check
        uint256 depositAmount = job.maximumReward - bidAmount;
        require(depositAmount == msg.value, "Invalid Collateral");

        // We just need winning bid, not all bid. If it's not winning bid, we should revert here.
        require(bidAmount < job.winningBidAmount, "You bid is declined.");

        // Refund prevoius winningBidAmount to previous winner.
        uint256 winningDeposit = job.maximumReward - job.winningBidAmount;
        (bool transferSuccess, ) = job.winningBidderAddress.call{
            value: winningDeposit
        }("");

        if (transferSuccess) {
            emit TransferFailed(job.winningBidderAddress, winningDeposit);
        }

        // Refund offset amount to the job creator.
        uint256 offsetAmount = job.winningBidAmount - bidAmount;
        (transferSuccess, ) = job.creatorAddress.call{value: offsetAmount}("");

        if (transferSuccess) {
            emit TransferFailed(job.creatorAddress, offsetAmount);
        }

        // Assign New Winner
        job.winningBidderAddress = payable(msg.sender);
        job.winningBidAmount = bidAmount;

        emit NewWinner(jobId, job.winningBidderAddress, job.winningBidAmount);
    }

    /*
     *  @notice With this, winner can execute job and get reward!
     *  @dev It checks if job is in valid status, and give all ether(reward + collateral)
     *  to the winner, and update the status.
     *  @param jobId ID of job to be executed.
     *  @param args Argument that should be passed to the job which is a function of contract.
     */
    function executeJob(uint256 jobId, bytes calldata args)
        external
        payable
        validJobID(jobId)
        pendingJob(jobId)
    {
        Job storage job = jobs[jobId];
        require(
            block.timestamp > job.delay + job.createdAt,
            "Job is still bidding"
        );
        require(
            block.timestamp < job.delay + job.createdAt + job.timeout,
            "Job Expired"
        );
        require(job.winningBidderAddress == msg.sender, "Not Winner.");

        // execute
        (bool success, ) = job.contractAddress.delegatecall(
            abi.encodeWithSignature(job.methodAbi, args)
        );
        require(success, "Job Execution Failed!");
        job.status = Status.EXECUTED;

        // Give Reward + Refund Collateral: Reward + Collateral = maximumReward
        (bool transferSuccess, ) = job.winningBidderAddress.call{
            value: job.maximumReward
        }("");
        if (transferSuccess) {
            emit TransferFailed(job.winningBidderAddress, job.maximumReward);
        }

        emit JobExecuted(jobId);
    }

    /*
     *  @notice This allows job creator to withdraw remaining ether in case of it's not executed.
     *  @dev It checks if it's creator and if job is not executed, and then refund to the creator.
     *  @param jobId ID of job that's scheduled.
     */
    function withdraw(uint256 jobId) public payable validJobID(jobId) {
        Job storage job = jobs[jobId];
        require(job.status != Status.EXECUTED, "Job is already executed");
        require(job.creatorAddress == msg.sender, "Not Creator");
        require(job.winningBidAmount != 0, "No ether to withdraw.");

        // Withdraw remaining ether to the creator's address.
        uint256 withdrawlAmount = job.winningBidAmount;
        (bool success, ) = job.creatorAddress.call{value: withdrawlAmount}("");
        require(success, "Withdraw Failed!");

        job.winningBidAmount = 0;
        job.status = Status.CANCELLED;

        emit Withdraw(jobId, withdrawlAmount);
    }
}
