// SPDX-License-Identifier: MIT
// Contract is a conjunction of several Tornado Cash contracts available on https://github.com/tornadocash/tornado-core/tree/master/contracts
// functions reclaim and submitRoot are written by myself. 
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IVerifier {
  function verifyProof(bytes memory _proof, uint256[6] memory _input) external returns (bool);
}

contract DestinationWrappedETH is ERC20, ReentrancyGuard {

    IVerifier public immutable verifier;
    address bridge;
    uint256 public denomination;
    mapping(bytes32 => bool) public nullifierHashes;

    // roots could be bytes32[size], but using mappings makes it cheaper because
    // it removes index range check on every interaction
    mapping(uint256 => bytes32) public roots;

    uint32 public constant ROOT_HISTORY_SIZE = 30;
    uint32 public currentRootIndex = 0;

    event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee);
    event Reclaim(address recipient, uint256 amount);

    /**
        @dev The constructor
        @param _verifier the address of SNARK verifier for this contract
        @param _bridge the address of bridge wallet
        @param _denomination transfer amount for each deposit
    */
    constructor(
        address _bridge,
        IVerifier _verifier,
        uint256 _denomination
    ) ERC20("PrivacyPreservingWrappedETH", "PPWETH") {
        require(_denomination > 0, "denomination should be greater than 0");
        bridge = _bridge;
        verifier = _verifier;
        denomination = _denomination;
    }

    modifier onlyBridge() {
        require(
            bridge == msg.sender,
            "This method can be called by bridge only!"
        );
        _;
    }

    function submitRoot(bytes32 root) external onlyBridge {
        uint32 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        currentRootIndex = newRootIndex;
        roots[newRootIndex] = root;
    }

    function reclaim(address recipient, uint256 amount) external nonReentrant {
        _burn(msg.sender, amount);
        emit Reclaim(recipient, amount);
    }

    /**
        @dev Withdraw a deposit made on origin chain to the . `proof` is a zkSNARK proof data, and input is an array of circuit public inputs
        `input` array consists of:
        - merkle root of all deposits in the contract
        - hash of unique deposit nullifier to prevent double spends
        - the recipient of funds
        - optional fee that goes to the transaction sender (usually a relay)
    */
    function withdraw(
        bytes calldata _proof,
        bytes32 _root,
        bytes32 _nullifierHash,
        address payable _recipient,
        address payable _relayer,
        uint256 _fee,
        uint256 _refund
    ) external payable nonReentrant {
        require(_fee <= denomination, "Fee exceeds transfer value");
        require(!nullifierHashes[_nullifierHash], "The note has been already spent");
        require(isKnownRoot(_root), "Cannot find your merkle root"); // Make sure to use a recent one
        require(
        verifier.verifyProof(
            _proof,
            [uint256(_root), uint256(_nullifierHash), uint256(_recipient), uint256(_relayer), _fee, _refund]
        ),
        "Invalid withdraw proof"
        );

        nullifierHashes[_nullifierHash] = true;
        _processWithdraw(_recipient, _relayer, _fee, _refund);
        emit Withdrawal(_recipient, _nullifierHash, _relayer, _fee);
    }


    function _processWithdraw(
        address payable _recipient,
        address payable _relayer,
        uint256 _fee,
        uint256 _refund
    ) internal {
        require(msg.value == _refund, "Incorrect refund amount received by the contract");

        _mint(_recipient, denomination - _fee);
        if (_fee > 0) {
            _mint(_relayer, _fee);
        }

        if (_refund > 0) {
            (bool success, ) = _recipient.call{ value: _refund }("");
            if (!success) {
                // let's return _refund back to the relayer
                _relayer.transfer(_refund);
            }
        }
    }


    function isSpent(bytes32 _nullifierHash) public view returns (bool) {
        return nullifierHashes[_nullifierHash];
    }

    /**
        @dev Whether the root is present in the root history
    */
    function isKnownRoot(bytes32 _root) public view returns (bool) {
        if (_root == 0) {
            return false;
        }
        uint32 _currentRootIndex = currentRootIndex;
        uint32 i = _currentRootIndex;
        do {
            if (_root == roots[i]) {
                return true;
            }
            if (i == 0) {
                i = ROOT_HISTORY_SIZE;
            }
            i--;
        } while (i != _currentRootIndex);
        return false;
    }

    /**
        @dev Returns the last root
    */
    function getLastRoot() public view returns (bytes32) {
        return roots[currentRootIndex];
    }

}