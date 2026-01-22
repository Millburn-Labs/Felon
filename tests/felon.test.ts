import { describe, expect, it, beforeEach } from "vitest";
import { Cl, simnet } from "@stacks/clarinet-sdk/vitest";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;

const contractName = "felon";
const minStake = 1_000_000n; // 1 STX
const lockPeriod = 100n;

describe("Felon Staking Platform", () => {
  beforeEach(() => {
    // Initialize contract before each test
    const initResult = simnet.callPublicFn(
      contractName,
      "initialize",
      [],
      deployer
    );
    expect(initResult.result).toBeOk(Cl.bool(true));
  });

  describe("Initialization", () => {
    it("should initialize contract and set deployer as owner", () => {
      const result = simnet.callReadOnlyFn(
        contractName,
        "get-config",
        [],
        deployer
      );
      expect(result.result).toBeOk(
        Cl.tuple({
          "min-stake": Cl.uint(minStake),
          "lock-period": Cl.uint(lockPeriod),
          "staking-paused": Cl.bool(false),
          owner: Cl.principal(deployer),
          "reward-per-share": Cl.uint(0),
          "total-rewards-added": Cl.uint(0),
        })
      );
    });

    it("should fail to initialize twice", () => {
      const result = simnet.callPublicFn(
        contractName,
        "initialize",
        [],
        deployer
      );
      expect(result.result).toBeErr(Cl.uint(107)); // err-already-inited
    });
  });

  describe("Staking", () => {
    it("should allow user to stake minimum amount", () => {
      const stakeAmount = minStake;
      const result = simnet.callPublicFn(
        contractName,
        "stake",
        [Cl.uint(stakeAmount)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Check stake was recorded
      const stakeInfo = simnet.callReadOnlyFn(
        contractName,
        "get-stake",
        [Cl.principal(wallet1)],
        wallet1
      );
      expect(stakeInfo.result).toBeSome(
        Cl.tuple({
          amount: Cl.uint(stakeAmount),
          "reward-debt": Cl.uint(0),
        })
      );

      // Check total staked
      const total = simnet.callReadOnlyFn(
        contractName,
        "get-total-staked",
        [],
        wallet1
      );
      expect(total.result).toBeUint(stakeAmount);
    });

    it("should fail to stake below minimum", () => {
      const result = simnet.callPublicFn(
        contractName,
        "stake",
        [Cl.uint(minStake - 1n)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(102)); // err-below-min
    });

    it("should fail to stake zero amount", () => {
      const result = simnet.callPublicFn(
        contractName,
        "stake",
        [Cl.uint(0)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(105)); // err-zero-amount
    });

    it("should allow multiple stakes and accumulate", () => {
      const firstStake = minStake;
      const secondStake = minStake * 2n;

      // First stake
      let result = simnet.callPublicFn(
        contractName,
        "stake",
        [Cl.uint(firstStake)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Second stake
      result = simnet.callPublicFn(
        contractName,
        "stake",
        [Cl.uint(secondStake)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Check accumulated stake
      const stakeInfo = simnet.callReadOnlyFn(
        contractName,
        "get-stake",
        [Cl.principal(wallet1)],
        wallet1
      );
      expect(stakeInfo.result).toBeSome(
        Cl.tuple({
          amount: Cl.uint(firstStake + secondStake),
          "reward-debt": Cl.uint(0),
        })
      );

      const total = simnet.callReadOnlyFn(
        contractName,
        "get-total-staked",
        [],
        wallet1
      );
      expect(total.result).toBeUint(firstStake + secondStake);
    });

    it("should fail to stake when paused", () => {
      // Pause staking
      let result = simnet.callPublicFn(
        contractName,
        "set-paused",
        [Cl.bool(true)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Try to stake
      result = simnet.callPublicFn(
        contractName,
        "stake",
        [Cl.uint(minStake)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(101)); // err-staking-paused
    });
  });

  describe("Rewards", () => {
    beforeEach(() => {
      // Stake some amount first
      simnet.callPublicFn(
        contractName,
        "stake",
        [Cl.uint(minStake * 2n)],
        wallet1
      );
    });

    it("should show zero pending rewards initially", () => {
      const result = simnet.callReadOnlyFn(
        contractName,
        "get-pending-rewards",
        [Cl.principal(wallet1)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(0));
    });

    it("should allow adding rewards to pool", () => {
      const rewardAmount = 1_000_000n;
      const result = simnet.callPublicFn(
        contractName,
        "add-rewards",
        [Cl.uint(rewardAmount)],
        wallet2
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Check config shows rewards added
      const config = simnet.callReadOnlyFn(
        contractName,
        "get-config",
        [],
        wallet1
      );
      expect(config.result).toBeOk(
        Cl.tuple({
          "total-rewards-added": Cl.uint(rewardAmount),
        })
      );
    });

    it("should calculate pending rewards after adding rewards", () => {
      const stakeAmount = minStake * 10n;
      const rewardAmount = minStake * 5n;

      // Stake
      simnet.callPublicFn(
        contractName,
        "stake",
        [Cl.uint(stakeAmount)],
        wallet1
      );

      // Add rewards
      simnet.callPublicFn(
        contractName,
        "add-rewards",
        [Cl.uint(rewardAmount)],
        wallet2
      );

      // Check pending rewards (should be proportional)
      const pending = simnet.callReadOnlyFn(
        contractName,
        "get-pending-rewards",
        [Cl.principal(wallet1)],
        wallet1
      );
      expect(pending.result).toBeOk(Cl.uintGreaterThan(0));
    });

    it("should allow claiming rewards", () => {
      const stakeAmount = minStake * 10n;
      const rewardAmount = minStake * 5n;

      // Stake
      simnet.callPublicFn(
        contractName,
        "stake",
        [Cl.uint(stakeAmount)],
        wallet1
      );

      // Add rewards
      simnet.callPublicFn(
        contractName,
        "add-rewards",
        [Cl.uint(rewardAmount)],
        wallet2
      );

      // Get initial balance
      const initialBalance = simnet.getAssetsMaps().stx[wallet1] || 0n;

      // Claim rewards
      const result = simnet.callPublicFn(
        contractName,
        "claim-rewards",
        [],
        wallet1
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Check balance increased
      const newBalance = simnet.getAssetsMaps().stx[wallet1] || 0n;
      expect(newBalance).toBeGreaterThan(initialBalance);

      // Pending rewards should be reset
      const pending = simnet.callReadOnlyFn(
        contractName,
        "get-pending-rewards",
        [Cl.principal(wallet1)],
        wallet1
      );
      expect(pending.result).toBeOk(Cl.uint(0));
    });

    it("should fail to claim when no rewards", () => {
      const result = simnet.callPublicFn(
        contractName,
        "claim-rewards",
        [],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(106)); // err-no-rewards
    });
  });

  describe("Unstaking", () => {
    beforeEach(() => {
      // Stake and advance blocks past lock period
      simnet.callPublicFn(
        contractName,
        "stake",
        [Cl.uint(minStake * 5n)],
        wallet1
      );
      simnet.mineEmptyBlocks(Number(lockPeriod) + 1);
    });

    it("should fail to unstake before lock period", () => {
      // Stake again to reset lock
      simnet.callPublicFn(
        contractName,
        "stake",
        [Cl.uint(minStake)],
        wallet2
      );

      // Try to unstake immediately
      const result = simnet.callPublicFn(
        contractName,
        "unstake",
        [Cl.uint(minStake)],
        wallet2
      );
      expect(result.result).toBeErr(Cl.uint(104)); // err-lock-not-expired
    });

    it("should allow unstaking after lock period", () => {
      const unstakeAmount = minStake * 2n;
      const initialBalance = simnet.getAssetsMaps().stx[wallet1] || 0n;

      const result = simnet.callPublicFn(
        contractName,
        "unstake",
        [Cl.uint(unstakeAmount)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Check balance increased
      const newBalance = simnet.getAssetsMaps().stx[wallet1] || 0n;
      expect(newBalance).toBeGreaterThan(initialBalance);

      // Check stake decreased
      const stakeInfo = simnet.callReadOnlyFn(
        contractName,
        "get-stake",
        [Cl.principal(wallet1)],
        wallet1
      );
      expect(stakeInfo.result).toBeSome(
        Cl.tuple({
          amount: Cl.uint(minStake * 3n),
        })
      );
    });

    it("should fail to unstake more than staked", () => {
      const stakeAmount = minStake * 2n;
      const unstakeAmount = minStake * 3n;

      const result = simnet.callPublicFn(
        contractName,
        "unstake",
        [Cl.uint(unstakeAmount)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(103)); // err-insufficient-stake
    });

    it("should remove stake entry when unstaking all", () => {
      const stakeAmount = minStake * 2n;

      const result = simnet.callPublicFn(
        contractName,
        "unstake",
        [Cl.uint(stakeAmount)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Stake entry should be deleted
      const stakeInfo = simnet.callReadOnlyFn(
        contractName,
        "get-stake",
        [Cl.principal(wallet1)],
        wallet1
      );
      expect(stakeInfo.result).toBeNone();
    });

    it("should claim rewards when unstaking", () => {
      const stakeAmount = minStake * 5n;
      const rewardAmount = minStake * 2n;

      // Add rewards first
      simnet.callPublicFn(
        contractName,
        "add-rewards",
        [Cl.uint(rewardAmount)],
        wallet2
      );

      const initialBalance = simnet.getAssetsMaps().stx[wallet1] || 0n;

      // Unstake (should also claim rewards)
      const result = simnet.callPublicFn(
        contractName,
        "unstake",
        [Cl.uint(minStake)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Balance should include both unstaked amount and rewards
      const newBalance = simnet.getAssetsMaps().stx[wallet1] || 0n;
      expect(newBalance).toBeGreaterThan(initialBalance + minStake);
    });
  });

  describe("Multiple Users", () => {
    it("should track stakes for multiple users independently", () => {
      const amount1 = minStake * 2n;
      const amount2 = minStake * 3n;

      // Wallet1 stakes
      simnet.callPublicFn(
        contractName,
        "stake",
        [Cl.uint(amount1)],
        wallet1
      );

      // Wallet2 stakes
      simnet.callPublicFn(
        contractName,
        "stake",
        [Cl.uint(amount2)],
        wallet2
      );

      // Check both stakes
      const stake1 = simnet.callReadOnlyFn(
        contractName,
        "get-stake",
        [Cl.principal(wallet1)],
        wallet1
      );
      expect(stake1.result).toBeSome(
        Cl.tuple({
          amount: Cl.uint(amount1),
        })
      );

      const stake2 = simnet.callReadOnlyFn(
        contractName,
        "get-stake",
        [Cl.principal(wallet2)],
        wallet2
      );
      expect(stake2.result).toBeSome(
        Cl.tuple({
          amount: Cl.uint(amount2),
        })
      );

      // Total should be sum
      const total = simnet.callReadOnlyFn(
        contractName,
        "get-total-staked",
        [],
        wallet1
      );
      expect(total.result).toBeUint(amount1 + amount2);
    });

    it("should distribute rewards proportionally", () => {
      const amount1 = minStake * 10n;
      const amount2 = minStake * 5n;
      const rewardAmount = minStake * 3n;

      // Both stake
      simnet.callPublicFn(
        contractName,
        "stake",
        [Cl.uint(amount1)],
        wallet1
      );
      simnet.callPublicFn(
        contractName,
        "stake",
        [Cl.uint(amount2)],
        wallet2
      );

      // Add rewards
      simnet.callPublicFn(
        contractName,
        "add-rewards",
        [Cl.uint(rewardAmount)],
        wallet3
      );

      // Wallet1 should have more rewards (2x stake)
      const pending1 = simnet.callReadOnlyFn(
        contractName,
        "get-pending-rewards",
        [Cl.principal(wallet1)],
        wallet1
      );
      const pending2 = simnet.callReadOnlyFn(
        contractName,
        "get-pending-rewards",
        [Cl.principal(wallet2)],
        wallet2
      );

      expect(pending1.result).toBeOk(Cl.uintGreaterThan(0));
      expect(pending2.result).toBeOk(Cl.uintGreaterThan(0));
      // Wallet1 should have approximately 2x wallet2's rewards
      const p1 = pending1.result.value as bigint;
      const p2 = pending2.result.value as bigint;
      expect(p1).toBeGreaterThan(p2);
    });
  });

  describe("Owner Functions", () => {
    it("should allow owner to pause staking", () => {
      const result = simnet.callPublicFn(
        contractName,
        "set-paused",
        [Cl.bool(true)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      const config = simnet.callReadOnlyFn(
        contractName,
        "get-config",
        [],
        deployer
      );
      expect(config.result).toBeOk(
        Cl.tuple({
          "staking-paused": Cl.bool(true),
        })
      );
    });

    it("should allow owner to unpause staking", () => {
      // Pause first
      simnet.callPublicFn(
        contractName,
        "set-paused",
        [Cl.bool(true)],
        deployer
      );

      // Unpause
      const result = simnet.callPublicFn(
        contractName,
        "set-paused",
        [Cl.bool(false)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));
    });

    it("should fail for non-owner to pause", () => {
      const result = simnet.callPublicFn(
        contractName,
        "set-paused",
        [Cl.bool(true)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(100)); // err-owner-only
    });

    it("should allow owner to transfer ownership", () => {
      const result = simnet.callPublicFn(
        contractName,
        "set-owner",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // New owner can pause
      const pauseResult = simnet.callPublicFn(
        contractName,
        "set-paused",
        [Cl.bool(true)],
        wallet1
      );
      expect(pauseResult.result).toBeOk(Cl.bool(true));
    });

    it("should fail for non-owner to transfer ownership", () => {
      const result = simnet.callPublicFn(
        contractName,
        "set-owner",
        [Cl.principal(wallet2)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(100)); // err-owner-only
    });
  });

  describe("Edge Cases", () => {
    it("should handle compound staking (rewards added to stake)", () => {
      const stakeAmount = minStake * 10n;
      const rewardAmount = minStake * 5n;

      // Stake
      simnet.callPublicFn(
        contractName,
        "stake",
        [Cl.uint(stakeAmount)],
        wallet1
      );

      // Add rewards
      simnet.callPublicFn(
        contractName,
        "add-rewards",
        [Cl.uint(rewardAmount)],
        wallet2
      );

      // Get initial stake
      const initialStake = simnet.callReadOnlyFn(
        contractName,
        "get-stake",
        [Cl.principal(wallet1)],
        wallet1
      );
      const initialAmount = (initialStake.result.value as any).amount;

      // Stake again (should compound pending rewards)
      simnet.callPublicFn(
        contractName,
        "stake",
        [Cl.uint(minStake)],
        wallet1
      );

      // New stake should include compounded rewards
      const newStake = simnet.callReadOnlyFn(
        contractName,
        "get-stake",
        [Cl.principal(wallet1)],
        wallet1
      );
      const newAmount = (newStake.result.value as any).amount;
      expect(newAmount).toBeGreaterThan(initialAmount + minStake);
    });

    it("should fail to add zero rewards", () => {
      const result = simnet.callPublicFn(
        contractName,
        "add-rewards",
        [Cl.uint(0)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(105)); // err-zero-amount
    });

    it("should fail to add rewards when paused", () => {
      // Pause
      simnet.callPublicFn(
        contractName,
        "set-paused",
        [Cl.bool(true)],
        deployer
      );

      // Try to add rewards
      const result = simnet.callPublicFn(
        contractName,
        "add-rewards",
        [Cl.uint(minStake)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(101)); // err-staking-paused
    });
  });
});
