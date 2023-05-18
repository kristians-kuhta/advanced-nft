// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract AdvancedNft is ERC721("Advanced NFT", "ADV"), Ownable {
  enum Stages {
    Inactive,
    PreSale,
    PublicSale,
    SoldOut
  }

  error FunctionInvalidAtThisStage();

  event StageTransition(uint256 indexed from, uint256 indexed to);

  Stages public stage;

  constructor() {
    stage = Stages.Inactive;
  }

  modifier atStage(Stages stage_) {
    if (stage != stage_) {
      revert FunctionInvalidAtThisStage();
    }

    _;
  }

  function activatePresale() public onlyOwner atStage(Stages.Inactive) {
    stage = Stages.PreSale;
    emit StageTransition(uint256(Stages.Inactive), uint256(Stages.PreSale));
  }
}
