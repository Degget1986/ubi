const { expect } = require("chai");
const deploymentParams = require('../deployment-params');

/**
 @function delay
 @summary halts execution for a given interval of milliseconds.
 @param {string} interval in milliseconds.
*/
const delay = async (interval) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, interval);
  });
}

/**
 @summary Tests for UBI.sol
*/
contract('UBI (Upgradeable Contract)', accounts => {
  describe('UBI Coin and Proof of Humanity', () => {
    before(async () => {
      accounts = await ethers.getSigners();

      const [_addresses, mockProofOfHumanity] = await Promise.all([
        Promise.all(accounts.map((account) => account.getAddress())),
        waffle.deployMockContract(
          accounts[0],
          require("../artifacts/contracts/UBI.sol/IProofOfHumanity.json").abi
        ),
      ]);
      addresses = _addresses;
      setSubmissionIsRegistered = (submissionID, isRegistered) =>
        mockProofOfHumanity.mock.getSubmissionInfo
          .withArgs(submissionID)
          .returns(0, 0, 0, 0, isRegistered);

      UBICoin = await ethers.getContractFactory("UBI");

      ubi = await upgrades.deployProxy(UBICoin,
        [deploymentParams.INITIAL_SUPPLY, deploymentParams.TOKEN_NAME, deploymentParams.TOKEN_SYMBOL, deploymentParams.ACCRUED_PER_SECOND, mockProofOfHumanity.address],
        { initializer: 'initialize', unsafeAllowCustomTypes: true }
      );

      await ubi.deployed();

      altProofOfHumanity = await waffle.deployMockContract(accounts[0], require("../artifacts/contracts/UBI.sol/IProofOfHumanity.json").abi);
    });

    it("Return a value previously initialized.", async () => {
      // Check that the value passed to the constructor is set.
      expect((await ubi.accruedPerSecond()).toString()).to.equal(deploymentParams.ACCRUED_PER_SECOND.toString());
    });

    it("Allows the governor to change `accruedPerSecond`.", async () => {
      // Make sure it reverts if we are not the governor.
      await expect(
        ubi.connect(accounts[1]).changeAccruedPerSecond(2)
      ).to.be.revertedWith("The caller is not the governor.");

      // Set the value to 2.
      await ubi.changeAccruedPerSecond(2);
      expect((await ubi.accruedPerSecond()).toString()).to.equal('2');
    });

    it("Allows the governor to emit `Snapshot` event.", async () => {
      // Make sure it reverts if we are not the governor.
      await expect(
        ubi.connect(accounts[1]).snapshot()
      ).to.be.revertedWith("The caller is not the governor.");

      // Emit Snapshot from governor address
      await expect(ubi.snapshot())
        .to.emit(ubi, "Snapshot")
    });

    it("Allows registered submissions to start accruing UBI.", async () => {
      // Check that the initial `lastMintedSecond` value is 0.
      expect((await ubi.lastMintedSecond(addresses[1])).toString()).to.equal('0');

      // Make sure it reverts if the submission is not registered.
      await setSubmissionIsRegistered(addresses[1], false);
      await expect(
        ubi.startAccruing(addresses[1])
      ).to.be.revertedWith(
        "The submission is not registered in Proof Of Humanity."
      );

      // Start accruing UBI and check that the current block number was set.
      await setSubmissionIsRegistered(addresses[1], true);
      await ubi.startAccruing(addresses[1]);
      const lastMinted = await ubi.lastMintedSecond(addresses[1]);
      expect((await ubi.lastMintedSecond(addresses[1])).toString()).to.equal(
        lastMinted.toString()
      );

      // Make sure it reverts if you try to accrue UBI while already accruing UBI.
      await expect(
        ubi.startAccruing(addresses[1])
      ).to.be.revertedWith("The submission is already accruing UBI.");
    });

    it("Allows the minting of accrued UBI.", async () => {
      // Make sure it reverts if the submission is not registered.
      await setSubmissionIsRegistered(addresses[1], false);
      await expect(
        ubi.mintAccrued(addresses[1])
      ).to.be.revertedWith(
        "The submission is not registered in Proof Of Humanity."
      );

      // Make sure it reverts if the submission is not accruing UBI.
      await setSubmissionIsRegistered(addresses[2], true);
      await expect(
        ubi.mintAccrued(addresses[2])
      ).to.be.revertedWith("The submission is not accruing UBI.");

      // Make sure it accrues value with elapsed time
      const [owner] = await ethers.getSigners();
      await setSubmissionIsRegistered(owner.address, true);
      await ubi.startAccruing(owner.address);
      const initialBalance = await ubi.balanceOf(owner.address);
      const initialMintedSecond = await ubi.lastMintedSecond(owner.address);
      await delay(2000);
      await ubi.mintAccrued(owner.address);
      const lastMintedSecond = await ubi.lastMintedSecond(owner.address);

      expect(lastMintedSecond).to.be.above(initialMintedSecond);
      expect(await ubi.balanceOf(owner.address)).to.be.above(initialBalance);

      await expect(ubi.mintAccrued(owner.address))
        .to.emit(ubi, "Mint")
    });

    it("Allows anyone to report a removed submission for their accrued UBI.", async () => {
      // Make sure it reverts if the submission is still registered.
      await setSubmissionIsRegistered(addresses[6], true);
      await ubi.startAccruing(addresses[6]);
      await expect(
        ubi.reportRemoval(addresses[6])
      ).to.be.revertedWith(
        "The submission is still registered in Proof Of Humanity."
      );

      // Make sure it reverts if the submission is not accruing UBI.
      await setSubmissionIsRegistered(addresses[5], true);
      await expect(
        ubi.reportRemoval(addresses[5])
      ).to.be.revertedWith("The submission is not accruing UBI.");

      // Report submission and verify that `accruingSinceBlock` was reset.
      // Also verify that the accrued UBI was sent correctly.
      await ubi.lastMintedSecond(addresses[1]);
      await expect(ubi.reportRemoval(addresses[1])).to.emit(ubi, "Mint");
      expect((await ubi.lastMintedSecond(addresses[1])).toString()).to.equal('0');
    });

    it("Returns 0 for submissions that are not accruing UBI.", async () => {
      expect((await ubi.getAccruedValue(addresses[5])).toString()).to.equal('0');
    });

    it("Allows the governor to change `proofOfHumanity`.", async () => {
      // Make sure it reverts if we are not the governor.
      await expect(
        ubi.connect(accounts[1]).changeProofOfHumanity(altProofOfHumanity.address)
      ).to.be.revertedWith("The caller is not the governor.");

      // Set the value to an alternative proof of humanity registry
      const originalProofOfHumanity = await ubi.proofOfHumanity();
      await ubi.changeProofOfHumanity(altProofOfHumanity.address);
      expect(await ubi.proofOfHumanity()).to.equal(altProofOfHumanity.address);
      expect(await ubi.proofOfHumanity()).to.not.equal(originalProofOfHumanity);
    });

  });
})