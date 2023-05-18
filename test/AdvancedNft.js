const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");

describe("Advanced NFT", function () {
  async function deployToken() {
    const [firstAccount, secondAccount] = await ethers.getSigners();

    const TokenFactory = await ethers.getContractFactory("AdvancedNft");
    const token = await TokenFactory.deploy();

    return { token, firstAccount, secondAccount};
  }

  describe("Deployment", function () {
    it("sets the symbol", async function () {
      const { token } = await loadFixture(deployToken);

      expect(await token.name()).to.equal('Advanced NFT');
    });

    it("sets the name", async function () {
      const { token } = await loadFixture(deployToken);

      expect(await token.symbol()).to.equal('ADV');
    });

    it("initializes contract to inactive stage", async function () {
      const { token } = await loadFixture(deployToken);

      expect(await token.stage()).to.equal(0);
    });
  });

  describe("Presale minting", function () {
    it("activates the presale when called by owner", async function() {
      const { token } = await loadFixture(deployToken);

      await expect(token.activatePresale()).to.emit(token, "StageTransition").withArgs(0, 1);
      expect(await token.stage()).to.equal(1);
    });

    it("reverts when trying to activate presale by non-owner", async function() {
      const { token, secondAccount } = await loadFixture(deployToken);

      await expect(token.connect(secondAccount).activatePresale()).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("reverts when trying to activate presale and presale is already active", async function() {
      const { token, secondAccount } = await loadFixture(deployToken);

      await expect(token.activatePresale()).to.emit(token, "StageTransition").withArgs(0, 1);
      await expect(token.activatePresale()).to.be.revertedWithCustomError(
        token,
        "FunctionInvalidAtThisStage"
      );
    });
  });
});

