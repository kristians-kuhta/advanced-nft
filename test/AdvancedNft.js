const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const { MerkleTree } = require("merkletreejs");
const { utils } = ethers;

describe("Advanced NFT", function () {
  function buildMerkleWhitelist(accounts) {
    const leafNodes = accounts.map((account, idx) => {
      const paddedAddress = utils.hexZeroPad(account, 32).toLowerCase();
      // const addressBytes = utils.arrayify(utils.hexZeroPad(account, 32).toLowerCase());
      // // const addressBytes = utils.arrayify(utils.getAddress(account));
      const ticketBytes = utils.hexZeroPad(utils.hexValue(idx + 1), 32).toLowerCase();

      const beforeHashing = Buffer.from(utils.concat([paddedAddress, ticketBytes]));
      const asdf = utils.keccak256(beforeHashing);

      return asdf;
    }).sort();

    const merkleTree = new MerkleTree(leafNodes, utils.keccak256, { sortPairs: true });

    return { leafNodes, merkleTree };
  }

  function getTokenFactory() {
    return ethers.getContractFactory("AdvancedNft");
  }

  async function deployToken() {
    const [
      firstAccount,
      secondAccount,
      thirdAccount,
      fourthAccount,
      fifthAccount
    ] = await ethers.getSigners();

    const TokenFactory = await getTokenFactory();
    const { merkleTree, leafNodes } = buildMerkleWhitelist([
      secondAccount.address,
      thirdAccount.address,
      fourthAccount.address,
      fifthAccount.address
    ]);

    // Max supply: 6 available, 4 whitelist spots
    const token = await TokenFactory.deploy(merkleTree.getRoot(), 6);

    return {
      token,
      firstAccount,
      secondAccount,
      fourthAccount,
      fifthAccount,
      merkleTree,
      leafNodes
    };
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

    it("reverts if trying to deploy without supply", async function() {
      const { token } = await loadFixture(deployToken);
      const TokenFactory = await getTokenFactory();

      expect(
        TokenFactory.deploy(utils.constants.AddressZero)
      ).to.be.reverted;
    });

    it("initializes contract to inactive stage", async function () {
      const { token } = await loadFixture(deployToken);

      expect(await token.stage()).to.equal(0);
    });

    it("reverts unless merkle root provided", async function () {
      const { token } = await loadFixture(deployToken);
      const TokenFactory = await getTokenFactory();

      expect(TokenFactory.deploy()).to.be.reverted;
    });

    it("returns merkle root", async function() {
      const { token, merkleTree } = await loadFixture(deployToken);

      expect(await token.merkleRoot()).to.equal(
        `0x${merkleTree.getRoot().toString('hex')}`
      );
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

    it("reverts when trying to presale mint while it has not been activated", async function() {
      const { token } = await loadFixture(deployToken);

      const dummyTicketNumber = 123;
      const dummyProofs = [];

      await expect(token.presaleMint(dummyTicketNumber, dummyProofs)).to.be.revertedWithCustomError(
        token,
        "FunctionInvalidAtThisStage"
      );
    });

    it("reverts if zero ticket number provided", async function () {
      const { token } = await loadFixture(deployToken);

      // TODO: expect full state transitions and emitted events
      await (await token.activatePresale()).wait();

      await expect(
        token.presaleMint(0, [1, 2, 3])
      ).to.be.revertedWith("Ticket not provided");
    });

    it("reverts if empty proof provided", async function () {
      const { token } = await loadFixture(deployToken);

      await (await token.activatePresale()).wait();

      await expect(
        token.presaleMint(1, [])
      ).to.be.revertedWith("Proof is empty");
    });

    it("reverts if could not prove due to ticket number for another address", async function () {
      const { token, merkleTree, leafNodes, firstAccount, secondAccount } = await loadFixture(deployToken);

      await (await token.activatePresale()).wait();

      const proofs = merkleTree.getHexProof(leafNodes[0]);

      // NOTE: secondAccount should have a ticket number of 1, 3 is invalid
      await expect(
        token.connect(secondAccount).presaleMint(3, proofs)
      ).to.be.revertedWith("Invalid proof");
    });

    it.only("reverts if could not prove due to one proofs being incorrect", async function () {
      const { token, merkleTree, leafNodes, firstAccount, secondAccount } = await loadFixture(deployToken);

      await (await token.activatePresale()).wait();
      const proofs = merkleTree.getHexProof(leafNodes[0]);

      const fakeProof = `0x999${proofs[1].substring(5)}`;

      // NOTE: secondAccount should have a ticket number of 1
      await expect(
        token.connect(secondAccount).presaleMint(1, [proofs[0], fakeProof])
      ).to.be.revertedWith("Invalid proof");
    });
//     it("mints a token for an address given presale ticket number and proofs", async function() {
//       const { token, firstAccount } = await loadFixture(deployToken);
//       const doesNotMatterTicketNumber = 123;
//       const proofs = [];

//       expect(await token.mint()).to.emit(token, "Transfer").withArgs(
//         firstAccount.address,
//         ethers.constants.AddressZero,
//         anyValue
//       );
//     });
//     it("reverts if trying to re-use ticket number and proofs", async function() {

    // TODO: deal with commit-reveal ids
    //     it("reverts mint if ", async function() {
    //     });
  });
});

