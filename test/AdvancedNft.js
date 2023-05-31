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

  async function prepareForPresaleMinting(token, minter, tokenId, options={}) {
    await expect(
      token.activatePresale()
    ).to.emit(token, "StageTransition").withArgs(0, 1);

    return await commitTokenIdAndMineBlocks(token, minter, tokenId, options);
  }

  async function prepareForPublicMinting(token, minter, tokenId, options={}) {
    await expect(
      token.activatePresale()
    ).to.emit(token, "StageTransition").withArgs(0, 1);

    await expect(
      token.activatePublicSale()
    ).to.emit(token, "StageTransition").withArgs(1, 2);

    return await commitTokenIdAndMineBlocks(token, minter, tokenId, options);
  }

  async function deployToken() {
    const [
      owner,
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
      TICKETS_COUNT
    );

    return {
      token,
      owner,
      secondAccount,
      thirdAccount,
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
      const salt = await prepareForPresaleMinting(token, secondAccount, tokenId, { mineBlocks: 9 });

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
      const salt = await prepareForPresaleMinting(token, secondAccount, tokenId, { mineBlocks: 9 });

      await expect(
        token.presaleMint(1, [], tokenId, salt)
      ).to.be.revertedWithCustomError(token, "ProofNotProvided");
    });

    it("reverts if could not prove due to ticket number for another address", async function () {
      const { token, merkleTree, leafNodes, secondAccount } = await loadFixture(deployToken);

      const proofs = merkleTree.getHexProof(leafNodes[0]);
      const tokenId = 123;
      const salt = await prepareForPresaleMinting(token, secondAccount, tokenId, { mineBlocks: 9 });

      // NOTE: secondAccount should have a ticket number of 1, 3 is invalid
      await expect(
        token.connect(secondAccount).presaleMint(3, proofs, tokenId, salt)
      ).to.be.revertedWithCustomError(token, "InvalidProof");
    });

    it("reverts if could not prove due to one proof being incorrect", async function () {
      const { token, merkleTree, leafNodes, secondAccount } = await loadFixture(deployToken);

      const proofs = merkleTree.getHexProof(leafNodes[0]);
      const tokenId = 123;
      const salt = await prepareForPresaleMinting(token, secondAccount, tokenId, { mineBlocks: 9 });

      const fakeProofNode = `0x999${proofs[1].substring(5)}`;

      const fakeProof = [proofs[0], fakeProofNode];

      await expect(
        token.connect(secondAccount).presaleMint(1, fakeProof, tokenId, salt)
      ).to.be.revertedWithCustomError(token, "InvalidProof");
    });

    it("reverts if trying to mint during presale when id secret was not commited", async function () {
      const { token, merkleTree, leafNodes, secondAccount } = await loadFixture(deployToken);

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
      const { token, merkleTree, leafNodes, secondAccount } = await loadFixture(deployToken);

      const proofs = merkleTree.getHexProof(leafNodes[0]);
      const tokenId = 123;
      await prepareForPresaleMinting(token, secondAccount, tokenId, { mineBlocks: 9 });
      const salt = Buffer.from(utils.randomBytes(32));

      // NOTE: secondAccount has a ticket number of 1
      await expect(
        token.connect(secondAccount).presaleMint(1, proofs, tokenId, salt)
      ).to.be.revertedWithCustomError(token, "IdAndSaltDoesNotMatchCommitted");
    });

    it("reverts if trying to re-use ticket number and proofs", async function() {
      const { token, merkleTree, leafNodes, secondAccount } = await loadFixture(deployToken);

      const proofs = merkleTree.getHexProof(leafNodes[0]);
      let tokenId = 123;
      let salt = await prepareForPresaleMinting(token, secondAccount, tokenId, { mineBlocks: 9 });

      await expect(
        token.connect(secondAccount).presaleMint(1, proofs, tokenId, salt)
      ).to.emit(token, 'Transfer').withArgs(
        ethers.constants.AddressZero,
        secondAccount.address,
        tokenId
      );

      tokenId = 124;
      salt = await commitTokenIdAndMineBlocks(token, secondAccount, tokenId, { mineBlocks: 9 });

      await expect(
        token.connect(secondAccount).presaleMint(1, proofs, tokenId, salt)
      ).to.be.revertedWithCustomError(token, 'TicketAlreadyUsed');
    });

    it("mints a token for an address during presale", async function() {
      const { token, merkleTree, leafNodes,  secondAccount } = await loadFixture(deployToken);

      const proofs = merkleTree.getHexProof(leafNodes[0]);
      const tokenId = 123;
      const salt = await prepareForPresaleMinting(token, secondAccount, tokenId, { mineBlocks: 9 });

      await expect(
        token.connect(secondAccount).presaleMint(1, proofs, tokenId, salt)
      ).to.emit(token, 'Transfer').withArgs(
        ethers.constants.AddressZero,
        secondAccount.address,
        tokenId
      );
    });
  });

  describe("Public minting", function () {
    it("returns mint price", async function() {
      const { token } = await loadFixture(deployToken);

      expect(await token.MINT_PRICE()).to.eq(utils.parseEther('1'));
    });

    it("mints a token during public sale", async function() {
      const { token, secondAccount } = await loadFixture(deployToken);

      const tokenId = 123;
      const salt = await prepareForPublicMinting(token, secondAccount, tokenId, { mineBlocks: 9 });

      const MINT_PRICE = utils.parseEther('1');

      await expect(
        token.connect(secondAccount).publicMint(tokenId, salt, { value: MINT_PRICE })
      ).to.emit(token, 'Transfer').withArgs(
        ethers.constants.AddressZero,
        secondAccount.address,
        123
      );
    });

    it("reverts if trying to public mint when public mint not active", async function() {
      const { token, secondAccount } = await loadFixture(deployToken);

      const tokenId = 123;
      const salt = Buffer.from(utils.randomBytes(32));

      const MINT_PRICE = utils.parseEther('1');

      await expect(
        token.connect(secondAccount).publicMint(tokenId, salt, { value: MINT_PRICE })
      ).to.be.revertedWithCustomError(token, "FunctionInvalidAtThisStage");
    });

    it("reverts if trying to public mint without sending mint price", async function() {
      const { token, secondAccount } = await loadFixture(deployToken);

      const tokenId = 123;
      const salt = await prepareForPublicMinting(token, secondAccount, tokenId, { mineBlocks: 9 });

      await expect(
        token.connect(secondAccount).publicMint(tokenId, salt)
      ).to.be.revertedWithCustomError(token, "ValueMustBeMintPrice");
    });

    it("reverts when trying to mint and max capacity reached", async function() {
      const {
        secondAccount,
        thirdAccount,
        fourthAccount,
        fifthAccount
      } = await loadFixture(deployToken);

      const TokenFactory = await getTokenFactory();

      const whitelistedAddresses = [
        secondAccount.address,
        thirdAccount.address,
        fourthAccount.address,
        fifthAccount.address
      ];

      const TICKETS_COUNT = whitelistedAddresses.length;
      const MAX_SUPPLY = 1;
      const MINT_PRICE = utils.parseEther('1');

      const { merkleTree } = buildMerkleWhitelist(whitelistedAddresses);

      const token = await TokenFactory.deploy(
        merkleTree.getRoot(),
        1,
        TICKETS_COUNT
      );

      const tokenId1 = 123;
      const salt1 = await prepareForPublicMinting(token, secondAccount, tokenId1, { mineBlocks: 9 });

      await expect(
        token.connect(secondAccount).publicMint(tokenId1, salt1, { value: MINT_PRICE })
      ).to.emit(token, 'Transfer').withArgs(
        ethers.constants.AddressZero,
        secondAccount.address,
        tokenId1
      );

      const tokenId2 = 124;
      const salt2 = await commitTokenIdAndMineBlocks(token, secondAccount, tokenId2, { mineBlocks: 9 });

      await expect(
        token.connect(secondAccount).publicMint(tokenId2, salt2, { value: MINT_PRICE })
      ).to.be.revertedWith("ERC721Capped: cap exceeded");
    });
  });

  describe("Contributors", function () {
    it("reverts when adding null address as contributor", async function() {
      const { token, owner } = await loadFixture(deployToken);

      await expect(
        token.connect(owner).addContributor(ethers.constants.AddressZero)
      ).to.be.revertedWithCustomError(token, "InvalidContributorAddress");
    });

    it("adds a contributor", async function() {
      const { token, developer1, owner } = await loadFixture(deployToken);

      await expect(
        token.connect(owner).addContributor(developer1.address)
      ).to.emit(token, 'ContributorAdded').withArgs(developer1.address);
    });
  });

  describe("Withdrawals", function () {
    it("allows a contributor to withdraw part of contract's balance", async function() {
      const { token, secondAccount, developer1 } = await loadFixture(deployToken);

      // TODO: reuse the mint thing and extract to into a function
      const tokenId = 123;
      const salt = await prepareForPublicMinting(token, secondAccount, tokenId, { mineBlocks: 9 });

      const MINT_PRICE = utils.parseEther('1');

      await expect(
        token.connect(secondAccount).publicMint(tokenId, salt, { value: MINT_PRICE })
      ).to.emit(token, 'Transfer').withArgs(
        ethers.constants.AddressZero,
        secondAccount.address,
        123
      );
      await (await token.addContributor(developer1.address)).wait();

      const tokenBalanceBefore = await ethers.provider.getBalance(token.address);
      const developer1BalanceBefore = await ethers.provider.getBalance(developer1.address);

      const WITHDRAW_AMOUNT = utils.parseEther('0.5');

      const withdrawResponse = await token.connect(developer1).withdraw(WITHDRAW_AMOUNT);
      const withdrawReceipt = await withdrawResponse.wait();

      const { gasUsed, effectiveGasPrice } = withdrawReceipt;
      const txFee = gasUsed.mul(effectiveGasPrice);

      const tokenBalanceAfter = await ethers.provider.getBalance(token.address);
      const developer1BalanceAfter = await ethers.provider.getBalance(developer1.address);

      expect(tokenBalanceAfter).to.eq(tokenBalanceBefore.sub(WITHDRAW_AMOUNT));
      expect(developer1BalanceAfter).to.eq(developer1BalanceBefore.add(WITHDRAW_AMOUNT.sub(txFee)));
    });

    it("reverts when a non-contributor withdraws", async function() {
      const { token, secondAccount } = await loadFixture(deployToken);

      // TODO: reuse the mint thing and extract to into a function
      const tokenId = 123;
      const salt = await prepareForPublicMinting(token, secondAccount, tokenId, { mineBlocks: 9 });

      const MINT_PRICE = utils.parseEther('1');

      await expect(
        token.connect(secondAccount).publicMint(tokenId, salt, { value: MINT_PRICE })
      ).to.emit(token, 'Transfer').withArgs(
        ethers.constants.AddressZero,
        secondAccount.address,
        123
      );
      // End of minting

      await expect(
        token.withdraw(123)
      ).to.be.revertedWithCustomError(token, "OnlyAllowedForContributors");
    });

    it("reverts when trying to withdraw more than contract balance", async function() {
      const { token, secondAccount } = await loadFixture(deployToken);

      // TODO: reuse the mint thing and extract to into a function
      const tokenId = 123;
      const salt = await prepareForPublicMinting(token, secondAccount, tokenId, { mineBlocks: 9 });

      const MINT_PRICE = utils.parseEther('1');

      await expect(
        token.connect(secondAccount).publicMint(tokenId, salt, { value: MINT_PRICE })
      ).to.emit(token, 'Transfer').withArgs(
        ethers.constants.AddressZero,
        secondAccount.address,
        123
      );
      // End of minting

      await expect(
        token.withdraw(MINT_PRICE.add(1))
      ).to.be.revertedWith("Insufficient balance");
    });

    it("reverts when trying to withdraw zero ether", async function() {
      const { token, secondAccount } = await loadFixture(deployToken);

      // TODO: reuse the mint thing and extract to into a function
      const tokenId = 123;
      const salt = await prepareForPublicMinting(token, secondAccount, tokenId, { mineBlocks: 9 });

      const MINT_PRICE = utils.parseEther('1');

      await expect(
        token.connect(secondAccount).publicMint(tokenId, salt, { value: MINT_PRICE })
      ).to.emit(token, 'Transfer').withArgs(
        ethers.constants.AddressZero,
        secondAccount.address,
        123
      );
      // End of minting

      await expect(
        token.withdraw(0)
      ).to.be.revertedWith("Must provide amount");
    });
  });
});

