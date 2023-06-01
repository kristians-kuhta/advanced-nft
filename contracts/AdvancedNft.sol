// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/structs/BitMaps.sol";

contract AdvancedNft is ERC721("Advanced NFT", "ADV"), Ownable {
  uint256 private immutable _cap;

  using Counters for Counters.Counter;
  Counters.Counter internal _tokenCounter;

  enum Stages {
    Inactive,
    PreSale,
    PublicSale,
    SoldOut
  }

  struct TokenIdCommit {
    bytes32 commit;
    uint64 blockNumber;
    bool revealed;
  }

  event StageTransition(uint256 indexed from, uint256 indexed to);
  event TokenIdCommitted(address indexed sender, bytes32 indexed dataHash, uint64 indexed blockNumber);
  event ContributorAdded(address indexed contributor);

  error FunctionInvalidAtThisStage();
  error IdAndSaltDoesNotMatchCommitted();
  error MustCommitIdBefore();
  error AfterCommitTimeoutForBlocks(uint256 remainingBlocks);
  error TicketNotProvided();
  error ProofNotProvided();
  error InvalidProof();
  error TicketAlreadyUsed();
  error InvalidContributorAddress();
  error OnlyAllowedForContributors();
  error ValueMustBeMintPrice();
  error MulticallSupportsOnlyTransferFrom();
  error CallsMustBePresent();

  Stages public stage;

  bytes32 public immutable merkleRoot;
  uint256 public constant MINT_PRICE = 1 * 10**18;

  uint256 public CAN_REVEAL_AFTER_BLOCKS = 10;

  mapping(address commiter => TokenIdCommit commit) private tokenIdCommits;
  mapping(address contributor => bool active) private contributors;

  using BitMaps for BitMaps.BitMap;
  BitMaps.BitMap private unusedTickets;

  constructor(
    bytes32 merkleRoot_,
    uint256 cap_,
    uint256 ticketsCount
  ) {
    require(merkleRoot_ != 0);
    require(cap_ > 0, "ERC721Capped: cap is 0");

    _cap = cap_;

    stage = Stages.Inactive;
    merkleRoot = merkleRoot_;

    for(uint256 i; i < ticketsCount; i++) {
      unusedTickets.set(i);
    }
  }

  modifier atStage(Stages stage_) {
    if (stage != stage_) {
      revert FunctionInvalidAtThisStage();
    }

    _;
  }

  // Internal validation functions

  function _requireIdCommittedAndNotRevealed(TokenIdCommit storage _idCommit) internal view {
    if(_idCommit.commit == "" || _idCommit.revealed) {
      revert MustCommitIdBefore();
    }
  }

  function _requireIdCommitBlocksPassed(TokenIdCommit storage _idCommit) internal view {
    if(block.number < _idCommit.blockNumber + CAN_REVEAL_AFTER_BLOCKS) {
      uint256 remainingBlocks = _idCommit.blockNumber + CAN_REVEAL_AFTER_BLOCKS - uint64(block.number);

      revert AfterCommitTimeoutForBlocks(remainingBlocks);
    }
  }

  function _requireTokenIdMatchesCommitted(
    TokenIdCommit storage _idCommit,
    uint256 _tokenId,
    bytes32 _salt
  ) internal view {
    if (_hashedIdAndSalt(_tokenId, _salt) != _idCommit.commit) {
      revert IdAndSaltDoesNotMatchCommitted();
    }
  }

  function _requireTicket(uint256 _ticket) internal pure {
    if (_ticket == 0) {
      revert TicketNotProvided();
    }
  }

  function _requireProof(bytes32[] calldata _proof) internal pure {
    if (_proof.length == 0) {
      revert ProofNotProvided();
    }
  }

  function _requireValidProof(uint256 _ticket, bytes32[] calldata _proof) internal {
    bytes32 leaf = merkleLeaf(_ticket);

    if(!MerkleProof.verify(_proof, merkleRoot, leaf)) {
      revert InvalidProof();
    }
  }

  function _requireUnusedTicket(uint256 _ticket) internal view {
    if (!unusedTickets.get(_ticket)) {
      revert TicketAlreadyUsed();
    }
  }

  function _requireContributorAddress(address _contributor) internal pure {
    if (_contributor == address(0)) {
      revert InvalidContributorAddress();
    }
  }

  function _requireContributor() internal view {
    if (!contributors[msg.sender]) {
      revert OnlyAllowedForContributors();
    }
  }

  function _requireMintPriceSent() internal view {
    if (msg.value != MINT_PRICE) {
      revert ValueMustBeMintPrice();
    }
  }

  function _requireValidCalls(bytes[] calldata calls) internal view {
    _requireCallsPresent(calls);
    //_requireAllCallsAreTransferFromCalls(calls);
  }

  function _requireCallsPresent(bytes[] calldata calls) internal view {
    if (calls.length == 0) {
      revert CallsMustBePresent();
    }
  }

  // function _requireAllCallsAreTransferFromCalls(bytes[] calls) internal view {
  //   bool allCallsAreTransferFromCalls = false;

  //   // bytes memory data = msg.data;
  //   bytes memory callsData = msg.data[5:];
  //   uint256 numOfCalls =



  //     if (allCallsAreTransferFromCalls) {
  //       revert MulticallSupportsOnlyTransferFrom();
  //     }

  //   if (

  // }

  function _runTokenIdValidations(TokenIdCommit storage idCommit, uint256 _tokenId, bytes32 _salt) internal view {
    // Validation: Token ID related
    _requireIdCommittedAndNotRevealed(idCommit);
    _requireIdCommitBlocksPassed(idCommit);
    _requireTokenIdMatchesCommitted(idCommit, _tokenId, _salt);
  }

  // Internal utility view functions

  function _hashedIdAndSalt(uint256 _tokenId, bytes32 _salt) internal view returns (bytes32) {
    return keccak256(abi.encodePacked(address(this), msg.sender, _tokenId, _salt));
  }

  // Internal function overrides

  function _mint(address _to, uint256 _tokenId) internal virtual override {
    require(_tokenCounter.current() <= _cap, "ERC721Capped: cap exceeded");
    super._mint(_to, _tokenId);
  }

  // Public view functions

  function merkleLeaf(uint256 _ticket) public view returns(bytes32) {
    return keccak256(abi.encode(msg.sender, _ticket));
  }

  // Public state changing functions

  function activatePresale() external onlyOwner atStage(Stages.Inactive) {
    stage = Stages.PreSale;

    emit StageTransition(uint256(Stages.Inactive), uint256(Stages.PreSale));
  }

  function activatePublicSale() external onlyOwner atStage(Stages.PreSale) {
    stage = Stages.PublicSale;

    emit StageTransition(uint256(Stages.PreSale), uint256(Stages.PublicSale));
  }

  function addContributor(address _contributor) external onlyOwner {
    _requireContributorAddress(_contributor);
    contributors[_contributor] = true;
    emit ContributorAdded(_contributor);
  }

  // @dev Commit token ID for the first time or replace previously committed one
  function commitTokenId(bytes32 commitHash) external {
    TokenIdCommit storage idCommit = tokenIdCommits[msg.sender];

    uint64 blockNumber = uint64(block.number);

    idCommit.revealed = false;
    idCommit.blockNumber = blockNumber;
    idCommit.commit = commitHash;

    emit TokenIdCommitted(msg.sender, commitHash, blockNumber);
  }

  function presaleMint(
    uint256 _ticket,
    bytes32[] calldata _proof,
    uint256 _tokenId,
    bytes32 _salt
  ) public atStage(Stages.PreSale) {
    _requireTicket(_ticket);
    _requireProof(_proof);

    TokenIdCommit storage idCommit = tokenIdCommits[msg.sender];

    _runTokenIdValidations(idCommit, _tokenId, _salt);

    _requireValidProof(_ticket, _proof);
    _requireUnusedTicket(_ticket);

    idCommit.revealed = true;
    unusedTickets.unset(_ticket);

    _tokenCounter.increment();

    _safeMint(msg.sender, _tokenId);
  }

  function publicMint(uint256 _tokenId, bytes32 _salt) public payable atStage(Stages.PublicSale) {
    _requireMintPriceSent();

    TokenIdCommit storage idCommit = tokenIdCommits[msg.sender];

    _runTokenIdValidations(idCommit, _tokenId, _salt);

    idCommit.revealed = true;

    _tokenCounter.increment();

    _safeMint(msg.sender, _tokenId);
  }

  // @dev This multicall implementation is intended only for `transferFrom` function
  function multicall(bytes[] calldata calls) external returns (bytes[] memory results) {
    _requireValidCalls(calls);

    results = new bytes[](calls.length);

    for (uint256 i = 0; i < calls.length; i++) {
      results[i] = Address.functionDelegateCall(address(this), calls[i]);
    }

    return results;
  }


  function withdraw(uint256 amount_) public {
    require(amount_ > 0, "Must provide amount");
    require(amount_ < address(this).balance, "Insufficient balance");

    _requireContributor();

    (bool success,) = payable(msg.sender).call{ value: amount_ }("");
    require(success, "Eth transfer failed");
  }
}
