// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "hardhat/console.sol";

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
  event TokenIdCommitted(address sender, bytes32 dataHash, uint64 blockNumber);

  error FunctionInvalidAtThisStage();
  error IdAndSaltDoesNotMatchCommitted();
  error MustCommitIdBefore();
  error AfterCommitTimeoutForBlocks(uint256 remainingBlocks);
  error TicketNotProvided();
  error ProofNotProvided();
  error InvalidProof();

  Stages public stage;

  bytes32 public immutable merkleRoot;
  uint256 public constant MINT_PRICE = 1 * 10**18;
  address private immutable developer1;
  address private immutable developer2;

  uint256 public CAN_REVEAL_AFTER_BLOCKS = 10;

  mapping(address commiter => TokenIdCommit commit) private tokenIdCommits;

  constructor(bytes32 merkleRoot_, uint256 cap_, address developer1_, address developer2_) {
    require(merkleRoot_ != 0);
    require(cap_ > 0, "ERC721Capped: cap is 0");

    _cap = cap_;

    stage = Stages.Inactive;
    merkleRoot = merkleRoot_;

    developer1 = developer1_;
    developer2 = developer2_;
  }

  modifier atStage(Stages stage_) {
    if (stage != stage_) {
      revert FunctionInvalidAtThisStage();
    }

    _;
  }

  // Internal validation functions
  function _requireDeveloper(address receiver_) internal view {
    if (receiver_ != developer1 && receiver_ != developer2) {
      revert('Not a developer');
    }
  }

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
    // TODO: add ticket checking logic here
  }

  // Internal utility view functions

  function _hashedIdAndSalt(uint256 _tokenId, bytes32 _salt) internal view returns (bytes32) {
    return keccak256(abi.encodePacked(address(this), _tokenId, _salt));
  }

  // Internal function overrides

  function _mint(address _to, uint256 _tokenId) internal virtual override {
    require(_tokenCounter.current() < _cap, "ERC721Capped: cap exceeded");
    super._mint(_to, _tokenId);
  }

  // Public view functions

  function merkleLeaf(uint256 _ticket) public view returns(bytes32) {
    return keccak256(abi.encode(msg.sender, _ticket));
  }

  // Public state changing functions

  function activatePresale() public onlyOwner atStage(Stages.Inactive) {
    stage = Stages.PreSale;

    emit StageTransition(uint256(Stages.Inactive), uint256(Stages.PreSale));
  }

  function activatePublicSale() public onlyOwner atStage(Stages.PreSale) {
    stage = Stages.PublicSale;

    emit StageTransition(uint256(Stages.PreSale), uint256(Stages.PublicSale));
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

    // Validation: Token ID related
    TokenIdCommit storage idCommit = tokenIdCommits[msg.sender];

    _requireIdCommittedAndNotRevealed(idCommit);
    _requireIdCommitBlocksPassed(idCommit);
    _requireTokenIdMatchesCommitted(idCommit, _tokenId, _salt);

    _requireValidProof(_ticket, _proof);
    _requireUnusedTicket(_ticket);
    // TODO: use bitmaps for registering used presale tickets

    idCommit.revealed = true;

    _tokenCounter.increment();

    _safeMint(msg.sender, _tokenId);
  }

  function publicMint() public payable atStage(Stages.PublicSale) {
    require(msg.value == MINT_PRICE, "Must send mint price");

    uint256 _tokenId = _tokenCounter.current();

    _tokenCounter.increment();

    _safeMint(msg.sender, _tokenId);
  }


  function withdraw(address developer_, uint256 amount_) public {
    require(amount_ < 0, "Must provide amount");
    require(amount_ < address(this).balance, "Insufficient balance");

    _requireDeveloper(developer_);

    (bool success,) = payable(developer_).call{value: amount_}("");
    require(success, "Eth transfer failed");
  }
}
