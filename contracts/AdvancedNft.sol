// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
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

  error FunctionInvalidAtThisStage();

  event StageTransition(uint256 indexed from, uint256 indexed to);

  Stages public stage;

  bytes32 public immutable merkleRoot;
  uint256 public constant MINT_PRICE = 1 * 10**18;
  address private immutable developer1;
  address private immutable developer2;

  constructor(bytes32 merkleRoot_, uint256 _cap, address developer1_, address developer2_) {
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

  function _requireDeveloper(address receiver_) internal {
    if (receiver_ != developer1 && receiver_ != developer2) {
      revert('Not a developer');
    }
  }

  function activatePresale() public onlyOwner atStage(Stages.Inactive) {
    stage = Stages.PreSale;

    emit StageTransition(uint256(Stages.Inactive), uint256(Stages.PreSale));
  }

  function activatePublicSale() public onlyOwner atStage(Stages.PreSale) {
    stage = Stages.PublicSale;

    emit StageTransition(uint256(Stages.PreSale), uint256(Stages.PublicSale));
  }

  function _mint(address _to, uint256 _tokenId) internal virtual override {
    require(_tokenCounter.current() < _cap, "ERC721Capped: cap exceeded");
    super._mint(_to, _tokenId);
  }

  function presaleMint(uint256 _ticket, bytes32[] calldata _proof) public atStage(Stages.PreSale) {
    require(_ticket != 0, "Ticket not provided");
    require(_proof.length != 0, "Proof is empty");

    bytes32 leaf = merkleLeaf(_ticket);
    require(MerkleProof.verify(_proof, merkleRoot, leaf), "Invalid proof");

    // TODO: use bitmaps for registering used presale tickets
    uint256 _tokenId = _tokenCounter.current();

    _tokenCounter.increment();


    _safeMint(msg.sender, _tokenId);
    // TODO: refactor: implement commit-reveal pattern for idx, instead of taking it from args
  }

  function publicMint() public payable atStage(Stages.PublicSale) {
    require(msg.value == MINT_PRICE, "Must send mint price");

    uint256 _tokenId = _tokenCounter.current();

    _tokenCounter.increment();

    _safeMint(msg.sender, _tokenId);
  }

  function merkleLeaf(uint256 _ticket) public view returns(bytes32) {
    return keccak256(abi.encode(msg.sender, _ticket));
  }

  function withdraw(address developer_) public {
    _requireDeveloper(developer_);

    (bool success, _) = payable(developer_).call{value: address(this).balance }("");
    require(success);
  }
}
