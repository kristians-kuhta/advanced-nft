// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract AdvancedNft is ERC721("Advanced NFT", "ADV") {
  enum Stages {
    Inactive,
    PreSale,
    PublicSale,
    SoldOut
  }

  error FunctionInvalidAtThisStage();

  Stages public stage;

  constructor() {
    stage = Stages.Inactive;
  }

  modifier atStage(Stages stage_) {
    if (stage != stage_)
      revert FunctionInvalidAtThisStage();
      _;
    }
  }
