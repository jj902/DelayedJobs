import { expect } from "chai";
import { ethers } from "hardhat";
import { DelayedJobScheduler, DummyJob } from "typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

function wait(seconds: number) {
  return new Promise(function (resolve) {
    setTimeout(resolve, seconds * 1000);
  });
}

describe("DelayedJobScheduler contract", function () {
  let DelayedJobScheduler;
  let jobScheduler: DelayedJobScheduler;
  let dummyJob: DummyJob;
  let creator: SignerWithAddress;
  let userA: SignerWithAddress;
  let userB: SignerWithAddress;
  let userC: SignerWithAddress;

  beforeEach(async function () {
    DelayedJobScheduler = await ethers.getContractFactory(
      "DelayedJobScheduler"
    );
    const DummyJob = await ethers.getContractFactory("DummyJob");
    [creator, userA, userB, userC] = await ethers.getSigners();

    jobScheduler = await DelayedJobScheduler.deploy();
    dummyJob = await DummyJob.deploy();
  });

  describe("createJob", function () {
    it("Should Fail: Invalid Contract Address", async function () {
      await expect(
        jobScheduler
          .connect(creator)
          .createJob(
            userA.address,
            "execute(bytes)",
            120,
            300,
            ethers.utils.parseEther("0.1")
          )
      ).to.be.revertedWith("Invalid Contract Address");
    });

    it("Should Fail: Invalid delay or timeout", async function () {
      await expect(
        jobScheduler
          .connect(creator)
          .createJob(
            dummyJob.address,
            "execute(bytes)",
            0,
            300,
            ethers.utils.parseEther("0.1")
          )
      ).to.be.revertedWith("Invalid delay or timeout");

      await expect(
        jobScheduler
          .connect(creator)
          .createJob(
            dummyJob.address,
            "execute(bytes)",
            120,
            0,
            ethers.utils.parseEther("0.1")
          )
      ).to.be.revertedWith("Invalid delay or timeout");
    });

    it("Should Fail: Invalid Maximum Reward", async function () {
      await expect(
        jobScheduler
          .connect(creator)
          .createJob(dummyJob.address, "execute(bytes)", 120, 300, 0)
      ).to.be.revertedWith("Invalid Maximum Reward");
    });

    it("Should Fail: Invalid Deposit Amount", async function () {
      await expect(
        jobScheduler
          .connect(creator)
          .createJob(
            dummyJob.address,
            "execute(bytes)",
            120,
            300,
            ethers.utils.parseEther("0.1")
          )
      ).to.be.revertedWith("Invalid Deposit Amount");
    });

    it("Should Success", async function () {
      await expect(
        jobScheduler
          .connect(creator)
          .createJob(
            dummyJob.address,
            "execute(bytes)",
            120,
            300,
            ethers.utils.parseEther("0.1"),
            {
              value: ethers.utils.parseEther("0.1"),
            }
          )
      )
        .to.emit(jobScheduler, "JobCreated")
        .withArgs(
          1,
          dummyJob.address,
          "execute(bytes)",
          120,
          300,
          ethers.utils.parseEther("0.1")
        );
    });
  });

  describe("bidJob", function () {
    beforeEach(async function () {
      await jobScheduler
        .connect(creator)
        .createJob(
          dummyJob.address,
          "execute(bytes)",
          3,
          10,
          ethers.utils.parseEther("0.1"),
          {
            value: ethers.utils.parseEther("0.1"),
          }
        );
    });

    it("Should Fail: Job Index is out of range", async function () {
      await expect(
        jobScheduler.connect(userA).bidJob(2, ethers.utils.parseEther("0.05"))
      ).to.be.revertedWith("Job Index is out of range.");
    });

    it("Should Fail: Invalid Bid Amount", async function () {
      await expect(
        jobScheduler.connect(userA).bidJob(1, ethers.utils.parseEther("0.2"))
      ).to.be.revertedWith("Invalid Bid Amount");

      await expect(
        jobScheduler.connect(userA).bidJob(1, ethers.utils.parseEther("0"))
      ).to.be.revertedWith("Invalid Bid Amount");
    });

    it("Should Fail: Invalid Collateral", async function () {
      await expect(
        jobScheduler.connect(userA).bidJob(1, ethers.utils.parseEther("0.05"))
      ).to.be.revertedWith("Invalid Collateral");

      await expect(
        jobScheduler.connect(userA).bidJob(1, ethers.utils.parseEther("0.05"), {
          value: ethers.utils.parseEther("0.06"),
        })
      ).to.be.revertedWith("Invalid Collateral");
    });

    it("Should Fail: Job Expired", async function () {
      await wait(3);
      await expect(
        jobScheduler.connect(userA).bidJob(1, ethers.utils.parseEther("0.05"))
      ).to.be.revertedWith("Job Expired");
    });

    it("Should Fail: You bid is declined.", async function () {
      await jobScheduler
        .connect(userA)
        .bidJob(1, ethers.utils.parseEther("0.05"), {
          value: ethers.utils.parseEther("0.05"),
        });
      await expect(
        jobScheduler.connect(userB).bidJob(1, ethers.utils.parseEther("0.07"), {
          value: ethers.utils.parseEther("0.03"),
        })
      ).to.be.revertedWith("You bid is declined.");
    });

    it("Should Fail: Already Executed or Cancelled", async function () {
      await jobScheduler.connect(creator).withdraw(1);
      await expect(
        jobScheduler.connect(userB).bidJob(1, ethers.utils.parseEther("0.07"), {
          value: ethers.utils.parseEther("0.03"),
        })
      ).to.be.revertedWith("Already Executed or Cancelled");
    });

    it("Should Success", async function () {
      await expect(
        jobScheduler.connect(userA).bidJob(1, ethers.utils.parseEther("0.07"), {
          value: ethers.utils.parseEther("0.03"),
        })
      )
        .to.emit(jobScheduler, "NewWinner")
        .withArgs(1, userA.address, ethers.utils.parseEther("0.07"));
    });
  });

  describe("executeJob", function () {
    beforeEach(async function () {
      await jobScheduler
        .connect(creator)
        .createJob(
          dummyJob.address,
          "execute(bytes)",
          3,
          3,
          ethers.utils.parseEther("0.1"),
          {
            value: ethers.utils.parseEther("0.1"),
          }
        );
    });

    it("Should Fail: Job Index is out of range", async function () {
      await expect(
        jobScheduler.connect(userA).executeJob(2, "0x123456")
      ).to.be.revertedWith("Job Index is out of range.");
    });

    it("Should Fail: Already Executed or Cancelled", async function () {
      await jobScheduler.connect(creator).withdraw(1);
      await expect(
        jobScheduler.connect(userA).executeJob(1, "0x123456")
      ).to.be.revertedWith("Already Executed or Cancelled");
    });

    it("Should Fail: Job is still bidding", async function () {
      await expect(
        jobScheduler.connect(userA).executeJob(1, "0x123456")
      ).to.be.revertedWith("Job is still bidding");
    });

    it("Should Fail: Job Expired", async function () {
      await wait(7);
      await expect(
        jobScheduler.connect(userA).executeJob(1, "0x123456")
      ).to.be.revertedWith("Job Expired");
    });

    it("Should Fail: Not Winner.", async function () {
      await jobScheduler
        .connect(userA)
        .bidJob(1, ethers.utils.parseEther("0.07"), {
          value: ethers.utils.parseEther("0.03"),
        });
      await wait(4);
      await expect(
        jobScheduler.connect(userB).executeJob(1, "0x123456")
      ).to.be.revertedWith("Not Winner.");
    });

    it("Should Success", async function () {
      await jobScheduler
        .connect(userA)
        .bidJob(1, ethers.utils.parseEther("0.07"), {
          value: ethers.utils.parseEther("0.03"),
        });
      await wait(4);
      await expect(jobScheduler.connect(userA).executeJob(1, "0x123456"))
        .to.emit(jobScheduler, "JobExecuted")
        .withArgs(1);
    });
  });

  describe("withdraw", function () {
    beforeEach(async function () {
      await jobScheduler
        .connect(creator)
        .createJob(
          dummyJob.address,
          "execute(bytes)",
          3,
          10,
          ethers.utils.parseEther("0.1"),
          {
            value: ethers.utils.parseEther("0.1"),
          }
        );
    });

    it("Should Fail: Job Index is out of range", async function () {
      await expect(
        jobScheduler.connect(creator).withdraw(2)
      ).to.be.revertedWith("Job Index is out of range.");
    });

    it("Should Fail: Job is already executed", async function () {
      await jobScheduler
        .connect(userA)
        .bidJob(1, ethers.utils.parseEther("0.07"), {
          value: ethers.utils.parseEther("0.03"),
        });
      await wait(4);
      await jobScheduler.connect(userA).executeJob(1, "0x123456");

      await expect(
        jobScheduler.connect(creator).withdraw(1)
      ).to.be.revertedWith("Job is already executed");
    });

    it("Should Fail: Not Creator", async function () {
      await expect(jobScheduler.connect(userA).withdraw(1)).to.be.revertedWith(
        "Not Creator"
      );
    });

    it("Should Fail: No ether to withdraw.", async function () {
      await jobScheduler.connect(creator).withdraw(1);
      await expect(
        jobScheduler.connect(creator).withdraw(1)
      ).to.be.revertedWith("No ether to withdraw.");
    });

    it("Should Success", async function () {
      await expect(jobScheduler.connect(creator).withdraw(1))
        .to.emit(jobScheduler, "Withdraw")
        .withArgs(1, ethers.utils.parseEther("0.1"));
    });
  });

  describe("E2E Test", function () {
    // Flow 1: Create Job with 0.1 ether, userA bid with 0.09 ether, userB bid with 0.07 ether, userC bid with 0.08 ether. Execute Job.
    it("Should Success: Full Flow, and Execute Job by winner", async function () {
      await expect(
        jobScheduler
          .connect(creator)
          .createJob(
            dummyJob.address,
            "execute(bytes)",
            5,
            10,
            ethers.utils.parseEther("0.1"),
            {
              value: ethers.utils.parseEther("0.1"),
            }
          )
      )
        .to.emit(jobScheduler, "JobCreated")
        .withArgs(
          1,
          dummyJob.address,
          "execute(bytes)",
          5,
          10,
          ethers.utils.parseEther("0.1")
        );

      await expect(
        jobScheduler.connect(userA).bidJob(1, ethers.utils.parseEther("0.09"), {
          value: ethers.utils.parseEther("0.01"),
        })
      )
        .to.emit(jobScheduler, "NewWinner")
        .withArgs(1, userA.address, ethers.utils.parseEther("0.09"));

      await expect(
        jobScheduler.connect(userB).bidJob(1, ethers.utils.parseEther("0.07"), {
          value: ethers.utils.parseEther("0.03"),
        })
      )
        .to.emit(jobScheduler, "NewWinner")
        .withArgs(1, userB.address, ethers.utils.parseEther("0.07"));

      await expect(
        jobScheduler.connect(userC).bidJob(1, ethers.utils.parseEther("0.08"), {
          value: ethers.utils.parseEther("0.02"),
        })
      ).to.be.revertedWith("You bid is declined.");

      await wait(4);
      await expect(jobScheduler.connect(userB).executeJob(1, "0x123456"))
        .to.emit(jobScheduler, "JobExecuted")
        .withArgs(1);
    });

    // Flow 2: Create Job with 0.1 ether, userA bid with 0.09 ether, userB bid with 0.07 ether, userC bid with 0.08 ether. Don't execute job and withdraw by creator
    it("Should Success: Full Flow, But not execute job, and withdraw by creator", async function () {
      await expect(
        jobScheduler
          .connect(creator)
          .createJob(
            dummyJob.address,
            "execute(bytes)",
            5,
            3,
            ethers.utils.parseEther("0.1"),
            {
              value: ethers.utils.parseEther("0.1"),
            }
          )
      )
        .to.emit(jobScheduler, "JobCreated")
        .withArgs(
          1,
          dummyJob.address,
          "execute(bytes)",
          5,
          3,
          ethers.utils.parseEther("0.1")
        );

      await expect(
        jobScheduler.connect(userA).bidJob(1, ethers.utils.parseEther("0.09"), {
          value: ethers.utils.parseEther("0.01"),
        })
      )
        .to.emit(jobScheduler, "NewWinner")
        .withArgs(1, userA.address, ethers.utils.parseEther("0.09"));

      await expect(
        jobScheduler.connect(userB).bidJob(1, ethers.utils.parseEther("0.07"), {
          value: ethers.utils.parseEther("0.03"),
        })
      )
        .to.emit(jobScheduler, "NewWinner")
        .withArgs(1, userB.address, ethers.utils.parseEther("0.07"));

      await expect(
        jobScheduler.connect(userC).bidJob(1, ethers.utils.parseEther("0.08"), {
          value: ethers.utils.parseEther("0.02"),
        })
      ).to.be.revertedWith("You bid is declined.");

      await wait(9);
      await expect(jobScheduler.connect(creator).withdraw(1))
        .to.emit(jobScheduler, "Withdraw")
        .withArgs(1, ethers.utils.parseEther("0.07"));
    });
  });
});
