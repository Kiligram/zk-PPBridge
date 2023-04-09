// SPDX-License-Identifier: MIT
// Contract is based on https://github.com/tornadocash/tornado-core/blob/master/contracts/Tornado.sol
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./MerkleTree.sol";

contract OriginWrappedETH is MerkleTree, ReentrancyGuard {

    uint256 public denomination;
    address bridge;

    // we store all commitments just to prevent accidental deposits with the same commitment
    mapping(bytes32 => bool) public commitments;

    event Deposit(bytes32 indexed commitment, uint32 leafIndex, bytes32 root, uint256 timestamp);

    /**
        @dev The constructor
        @param _hasher the address of MiMC hash contract
        @param _denomination transfer amount for each deposit
        @param _merkleTreeHeight the height of deposits' Merkle Tree
    */
    constructor(
        address _bridge,
        IHasher _hasher,
        uint256 _denomination,
        uint32 _merkleTreeHeight
    ) MerkleTree(_merkleTreeHeight, _hasher) {
        require(_denomination > 0, "denomination should be greater than 0");
        bridge = _bridge;
        denomination = _denomination;
    }

    modifier onlyBridge() {
        require(
            bridge == msg.sender,
            "This method can be called by bridge only!"
        );
        _;
    }

    function deposit(bytes32 _commitment) external payable nonReentrant {
        require(!commitments[_commitment], "The commitment has been submitted");
        require(msg.value == denomination, "Please send `mixDenomination` ETH along with transaction");
        
        (uint32 insertedIndex, bytes32 newRoot) = _insert(_commitment);
        commitments[_commitment] = true;

        emit Deposit(_commitment, insertedIndex, newRoot, block.timestamp);
    }


    function releaseFunds(address recepient, uint256 amount) external onlyBridge nonReentrant returns (bool) {
        (bool success, ) = recepient.call{ value: amount }("");
        return success;
    }

}