const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
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
});

