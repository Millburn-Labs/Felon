;; title: Felon
;; version: 1.0.0
;; summary: Decentralized STX staking platform on Stacks - stake STX, earn rewards
;; description: |
;;   Felon is a decentralized staking platform on Stacks. Users stake STX tokens
;;   and earn rewards. Stake your STX, claim rewards, and unstake when ready.
;;   Rewards can be added by the protocol admin and are distributed proportionally.

;; constants
(define-constant err-owner-only (err u100))
(define-constant err-staking-paused (err u101))
(define-constant err-below-min (err u102))
(define-constant err-insufficient-stake (err u103))
(define-constant err-lock-not-expired (err u104))
(define-constant err-zero-amount (err u105))
(define-constant err-no-rewards (err u106))
(define-constant err-transfer-failed (err u107))

(define-constant min-stake-amount u1000000) ;; 1 STX (10^6 micro-STX)
(define-constant lock-period u100) ;; 100 blocks before unstaking
(define-constant scale u1000000000000) ;; 1e12 for reward precision

;; data vars
(define-data-var total-staked u128 u0)
(define-data-var reward-per-share u128 u0)
(define-data-var total-rewards-added u128 u0)
(define-data-var staking-paused bool false)
(define-data-var owner principal (tx-sender))

;; data maps
(define-map stakes
  { staker: principal }
  {
    amount: u128,
    reward-debt: u128,
    staked-at-block: uint
  }
)

;; private: update reward-per-share when rewards are added or total-staked changes
(define-private (update-reward-per-share (new-rewards u128))
  (let ((total (var-get total-staked)))
    (if (<= total u0)
      (var-set total-rewards-added (+ (var-get total-rewards-added) new-rewards))
      (let ()
        (var-set total-rewards-added (+ (var-get total-rewards-added) new-rewards))
        (var-set reward-per-share
          (+ (var-get reward-per-share)
            (/ (* new-rewards scale) total)))
      )
    )
  )
)

;; private: calculate pending rewards for a staker
(define-private (pending-rewards (staker principal))
  (let ((entry (map-get? stakes { staker: staker })))
    (if (is-none entry)
      u0
      (let ((unwrap (unwrap-panic entry)))
        (let (
            (user-amount (get amount unwrap))
            (user-debt (get reward-debt unwrap))
            (acc (var-get reward-per-share))
          )
          (if (< (* user-amount acc) user-debt)
            u0
            (- (/ (* user-amount acc) scale) user-debt)
          )
        )
      )
    )
  )
)

;; public: stake STX. Caller must attach `amount` micro-STX to the transaction.
(define-public (stake (amount u128))
  (let (
      (caller (contract-caller))
      (ok (asserts! (not (var-get staking-paused)) err-staking-paused))
      (ok2 (asserts! (>= amount min-stake-amount) err-below-min))
      (ok3 (asserts! (> amount u0) err-zero-amount))
    )
    (let ((entry (map-get? stakes { staker: caller })))
      (let ((current (default-to { amount: u0, reward-debt: u0, staked-at-block: block-height } entry)))
        (let (
            (new-amount (+ (get amount current) amount))
            (pending (pending-rewards caller))
          )
          ;; update global total before we add to user (for reward-per-share)
          (var-set total-staked (+ (var-get total-staked) amount))
          (map-set stakes { staker: caller }
            {
              amount: new-amount,
              reward-debt: (- (/ (* new-amount (var-get reward-per-share)) scale) pending),
              staked-at-block: (get staked-at-block current)
            }
          )
          (ok true)
        )
      )
    )
  )
)

;; public: unstake STX. Lock period must have passed since last stake.
(define-public (unstake (amount u128))
  (let (
      (caller (contract-caller))
      (ok (asserts! (not (var-get staking-paused)) err-staking-paused))
      (ok2 (asserts! (> amount u0) err-zero-amount))
    )
    (let ((entry (map-get? stakes { staker: caller })))
      (asserts! (is-some entry) err-insufficient-stake)
      (let ((stake-info (unwrap-panic entry)))
        (let (
            (user-amount (get amount stake-info))
            (staked-at (get staked-at-block stake-info))
            (ok3 (asserts! (>= user-amount amount) err-insufficient-stake))
            (ok4 (asserts! (>= block-height (+ staked-at lock-period)) err-lock-not-expired))
          )
          ;; claim any pending rewards first (we'll add claim logic inline)
          (let ((pending (pending-rewards caller)))
            (if (> pending u0)
              (try! (as-contract (stx-transfer? pending (tx-sender) caller)))
              (ok u0)
            )
          )
          (let ((new-amount (- user-amount amount)))
            (var-set total-staked (- (var-get total-staked) amount))
            (if (<= new-amount u0)
              (map-delete stakes { staker: caller })
              (map-set stakes { staker: caller }
                {
                  amount: new-amount,
                  reward-debt: (/ (* new-amount (var-get reward-per-share)) scale),
                  staked-at-block: block-height
                }
              )
            )
            (try! (as-contract (stx-transfer? amount (tx-sender) caller)))
            (ok true)
          )
        )
      )
    )
  )
)

;; public: claim staking rewards without unstaking
(define-public (claim-rewards)
  (let ((caller (contract-caller)))
    (let ((pending (pending-rewards caller)))
      (asserts! (> pending u0) err-no-rewards)
      (let ((entry (map-get? stakes { staker: caller })))
        (asserts! (is-some entry) err-no-rewards)
        (let ((stake-info (unwrap-panic entry)))
          (map-set stakes { staker: caller }
            {
              amount: (get amount stake-info),
              reward-debt: (/ (* (get amount stake-info) (var-get reward-per-share)) scale),
              staked-at-block: (get staked-at-block stake-info)
            }
          )
          (as-contract (stx-transfer? pending (tx-sender) caller))
        )
      )
    )
  )
)

;; public: add rewards to the pool. Caller must attach STX. Owner-only or anyone can add.
(define-public (add-rewards (amount u128))
  (let (
      (ok (asserts! (not (var-get staking-paused)) err-staking-paused))
      (ok2 (asserts! (> amount u0) err-zero-amount))
    )
    (update-reward-per-share amount)
    (ok true)
  )
)

;; owner: pause staking
(define-public (set-paused (paused bool))
  (let ((ok (asserts! (is-eq (contract-caller) (var-get owner)) err-owner-only)))
    (var-set staking-paused paused)
    (ok true)
  )
)

;; owner: transfer ownership
(define-public (set-owner (new-owner principal))
  (let ((ok (asserts! (is-eq (contract-caller) (var-get owner)) err-owner-only)))
    (var-set owner new-owner)
    (ok true)
  )
)

;; read-only: get stake info for a staker
(define-read-only (get-stake (staker principal))
  (map-get? stakes { staker: staker })
)

;; read-only: get pending rewards for a staker
(define-read-only (get-pending-rewards (staker principal))
  (ok (pending-rewards staker))
)

;; read-only: total STX staked
(define-read-only (get-total-staked)
  (var-get total-staked)
)

;; read-only: contract config
(define-read-only (get-config)
  (ok {
    min-stake: min-stake-amount,
    lock-period: lock-period,
    staking-paused: (var-get staking-paused),
    owner: (var-get owner),
    reward-per-share: (var-get reward-per-share),
    total-rewards-added: (var-get total-rewards-added)
  })
)