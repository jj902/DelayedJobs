//SPDX-License-Identifier: Unlicense

pragma solidity >=0.8.0;

contract DummyJob {
    event Executed(bytes args);

    function execute(bytes calldata args) public {
        emit Executed(args);
    }
}
