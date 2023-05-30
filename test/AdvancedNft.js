const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const { MerkleTree } = require("merkletreejs");
const { utils } = ethers;

describe("Advanced NFT", function () {
  function buildMerkleWhitelist(accounts) {
    const leafNodes = accounts.map((account, idx) => {
      const paddedAddress = utils.hexZeroPad(account, 32).toLowerCase();

      // Ticket number = index of account in tree + 1
      const ticketBytes = utils.hexZeroPad(utils.hexValue(idx + 1), 32).toLowerCase();

      const leafBeforeHashing = Buffer.from(utils.concat([paddedAddress, ticketBytes]));

      return utils.keccak256(leafBeforeHashing);
    }).sort();

    const merkleTree = new MerkleTree(leafNodes, utils.keccak256, { sortPairs: true });

    return { leafNodes, merkleTree };
  }

  function getTokenFactory() {
    return ethers.getContractFactory("AdvancedNft");
  }

  async function commitTokenIdAndMineBlocks(token, minter, tokenId, options={}) {
    const mineBlocks = options.mineBlocks ? `0x${options.mineBlocks.toString(16)}` : null;

    const tokenIdHex = utils.hexZeroPad(tokenId, 32).toLowerCase();
    const salt = Buffer.from(utils.randomBytes(32));

    const commitDataBeforeHashing = Buffer.from(utils.concat([token.address, tokenIdHex, salt]));
    const hashedCommitData = utils.keccak256(commitDataBeforeHashing);

    const blockNumberBefore = await ethers.provider.getBlockNumber();

    await expect(
      token.connect(minter).commitTokenId(hashedCommitData)
    ).to.emit(token, "TokenIdCommitted").withArgs(
      minter.address,
      hashedCommitData,
      blockNumberBefore + 1
    );

    if (mineBlocks) {
      await hre.network.provider.send("hardhat_mine", [mineBlocks]);
    }

    return salt;
  }

  async function prepareForMinting(token, minter, tokenId, options={}) {
    await (await token.activatePresale()).wait();

    return await commitTokenIdAndMineBlocks(token, minter, tokenId, options);
  }

  async function deployToken() {
    const [
      firstAccount,
      secondAccount,
      thirdAccount,
      fourthAccount,
      fifthAccount,
      developer1,
      developer2
    ] = await ethers.getSigners();

    const TokenFactory = await getTokenFactory();

    const whitelistedAddresses = [
      secondAccount.address,
      thirdAccount.address,
      fourthAccount.address,
      fifthAccount.address
    ];
    const TICKETS_COUNT = whitelistedAddresses.length;

    const { merkleTree, leafNodes } = buildMerkleWhitelist(whitelistedAddresses);

    // Max supply: 6 available, 4 whitelist spots
    const token = await TokenFactory.deploy(
      merkleTree.getRoot(),
      6,
      developer1.address,
      developer2.address,
      TICKETS_COUNT
    );

    return {
      token,
      firstAccount,
      secondAccount,
      fourthAccount,
      fifthAccount,
      developer1,
      developer2,
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
        TokenFactory.deploy('', 0, ethers.constants.AddressZero, ethers.constants.AddressZero)
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
      const { token, merkleTree, leafNodes, secondAccount } = await loadFixture(deployToken);

      const proofs = merkleTree.getHexProof(leafNodes[0]);
      const tokenId = 123;
      const salt = await commitTokenIdAndMineBlocks(token, secondAccount, tokenId, { mineBlocks: 9 });
      // Ticket #1 is the correct number for the second account
      const ticketNumber = 1;

      await expect(
        token.connect(secondAccount).presaleMint(ticketNumber, proofs, tokenId, salt)
      ).to.be.revertedWithCustomError(
        token,
        "FunctionInvalidAtThisStage"
      );
    });

    it("reverts if zero ticket number provided", async function () {
      const { token, secondAccount } = await loadFixture(deployToken);

      const tokenId = 123;
      const salt = await prepareForMinting(token, secondAccount, tokenId, { mineBlocks: 9 });

      const proofs = [
        utils.hexZeroPad(1, 32),
        utils.hexZeroPad(2, 32),
        utils.hexZeroPad(3, 32)
      ];

      await hre.network.provider.send("hardhat_mine", ["0x9"]);

      await expect(
        token.presaleMint(0, proofs, tokenId, salt)
      ).to.be.revertedWithCustomError(token, "TicketNotProvided");
    });

    it("reverts if empty proof provided", async function () {
      const { token, secondAccount } = await loadFixture(deployToken);

      const tokenId = 123;
      const salt = await prepareForMinting(token, secondAccount, tokenId, { mineBlocks: 9 });

      await expect(
        token.presaleMint(1, [], tokenId, salt)
      ).to.be.revertedWithCustomError(token, "ProofNotProvided");
    });

    it("reverts if could not prove due to ticket number for another address", async function () {
      const { token, merkleTree, leafNodes, firstAccount, secondAccount } = await loadFixture(deployToken);

      const proofs = merkleTree.getHexProof(leafNodes[0]);
      const tokenId = 123;
      const salt = await prepareForMinting(token, secondAccount, tokenId, { mineBlocks: 9 });

      // NOTE: secondAccount should have a ticket number of 1, 3 is invalid
      await expect(
        token.connect(secondAccount).presaleMint(3, proofs, tokenId, salt)
      ).to.be.revertedWithCustomError(token, "InvalidProof");
    });

    it("reverts if could not prove due to one proof being incorrect", async function () {
      const { token, merkleTree, leafNodes, firstAccount, secondAccount } = await loadFixture(deployToken);

      const proofs = merkleTree.getHexProof(leafNodes[0]);
      const tokenId = 123;
      const salt = await prepareForMinting(token, secondAccount, tokenId, { mineBlocks: 9 });

      const fakeProofNode = `0x999${proofs[1].substring(5)}`;

      const fakeProof = [proofs[0], fakeProofNode];

      await expect(
        token.connect(secondAccount).presaleMint(1, fakeProof, tokenId, salt)
      ).to.be.revertedWithCustomError(token, "InvalidProof");
    });

    it("reverts if trying to mint during presale when id secret was not commited", async function () {
      const { token, merkleTree, leafNodes, firstAccount, secondAccount } = await loadFixture(deployToken);

      await (await token.activatePresale()).wait();

      // These arguments do not really matter
      const proofs = merkleTree.getHexProof(leafNodes[0]);
      const tokenId = 123;
      const salt = Buffer.from(utils.randomBytes(32));

      await expect(
        token.connect(secondAccount).presaleMint(1, proofs, tokenId, salt)
      ).to.be.revertedWithCustomError(token, "MustCommitIdBefore");
    });

    it("reverts if trying to mint during presale when incorrect salt provided", async function () {
      const { token, merkleTree, leafNodes, firstAccount, secondAccount } = await loadFixture(deployToken);

      const proofs = merkleTree.getHexProof(leafNodes[0]);
      const tokenId = 123;
      await prepareForMinting(token, secondAccount, tokenId, { mineBlocks: 9 });
      const salt = Buffer.from(utils.randomBytes(32));

      // NOTE: secondAccount has a ticket number of 1
      await expect(
        token.connect(secondAccount).presaleMint(1, proofs, tokenId, salt)
      ).to.be.revertedWithCustomError(token, "IdAndSaltDoesNotMatchCommitted");
    });

    it("reverts if trying to re-use ticket number and proofs", async function() {
      const { token, merkleTree, leafNodes, firstAccount, secondAccount } = await loadFixture(deployToken);

      const proofs = merkleTree.getHexProof(leafNodes[0]);
      let tokenId = 123;
      let salt = await prepareForMinting(token, secondAccount, tokenId, { mineBlocks: 9 });

      await expect(
        token.connect(secondAccount).presaleMint(1, proofs, tokenId, salt)
      ).to.emit(token, 'Transfer').withArgs(
        ethers.constants.AddressZero,
        secondAccount.address,
        123
      );

      tokenId = 124;
      salt = await commitTokenIdAndMineBlocks(token, secondAccount, tokenId, { mineBlocks: 9 });

      await expect(
        token.connect(secondAccount).presaleMint(1, proofs, tokenId, salt)
      ).to.be.revertedWithCustomError(token, 'TicketAlreadyUsed');
    });

    it("mints a token for an address during presale", async function() {
      const { token, merkleTree, leafNodes, firstAccount, secondAccount } = await loadFixture(deployToken);

      const proofs = merkleTree.getHexProof(leafNodes[0]);
      const tokenId = 123;
      const salt = await prepareForMinting(token, secondAccount, tokenId, { mineBlocks: 9 });

      await expect(
        token.connect(secondAccount).presaleMint(1, proofs, tokenId, salt)
      ).to.emit(token, 'Transfer').withArgs(
        ethers.constants.AddressZero,
        secondAccount.address,
        123
      );
    });
  });
});

