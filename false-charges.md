# False Commission Increase Charges (Epochs 900-930)

Analysis of wrongly charged validators due to a bug in `analyze-revenue.cmd.ts` where
`getValidatorOverrides()` used raw on-chain commissions for snapshot overrides, while the
SDK's native computation applied `Math.min(bond, onchain)` (bond-capped commissions). This
asymmetry caused validators with bond commission < on-chain commission to appear as if they
had increased their commission, when in reality their effective commission was unchanged.

**Methodology:** Ran both old code (pre-fix, commit `23040f1`) and new code (with fix, commit
`54e3e3e`) against all pipeline auction data for epochs 900-930. False charges are entries
where the old code detected a commission difference but the new code does not. All 53 detected
differences were confirmed as false positives (zero valid detections).

## Inflation False Charges (actually charged)

31 entries across 3 validators with `lossPerStake > 0`. The false charge SOL is computed as
`lossPerStake * marinadeSamTargetSol` (actual SAM stake allocated to the validator).

### `86Sw9R6ynPmXnHfwUWinXtq1QoF2KHesfQQyZG5r8sXo`

Bond inflation commission: 2%, on-chain commission: 3%.
Old code used 3% (on-chain), SDK used 2% (bond-capped) = false 1% increase detected.

| Epoch        | Expected | Charged | SAM Stake (SOL) | False Charge (SOL) |
| ------------ | -------- | ------- | --------------: | -----------------: |
| 902          | 2.00%    | 3.00%   |         200,000 |             0.6647 |
| 903          | 2.00%    | 3.00%   |         200,000 |             0.6635 |
| 904          | 2.00%    | 3.00%   |         200,000 |             0.6618 |
| 905          | 2.00%    | 3.00%   |         200,000 |             0.6604 |
| 906          | 2.00%    | 3.00%   |         200,000 |             0.6590 |
| 907          | 2.00%    | 3.00%   |         200,000 |             0.6574 |
| 908          | 2.00%    | 3.00%   |         200,000 |             0.6562 |
| 909          | 2.00%    | 3.00%   |         200,000 |             0.6549 |
| 910          | 2.00%    | 3.00%   |         200,000 |             0.6537 |
| 911          | 2.00%    | 3.00%   |         200,000 |             0.6527 |
| 912          | 2.00%    | 3.00%   |         200,000 |             0.6516 |
| 913          | 2.00%    | 3.00%   |         193,600 |             0.6297 |
| 914          | 2.00%    | 3.00%   |         191,461 |             0.6219 |
| 915          | 2.00%    | 3.00%   |         181,892 |             0.5899 |
| 916          | 2.00%    | 3.00%   |         181,801 |             0.5890 |
| 917          | 2.00%    | 3.00%   |         181,518 |             0.5870 |
| 918          | 2.00%    | 3.00%   |         175,111 |             0.5656 |
| 919          | 2.00%    | 3.00%   |         162,894 |             0.5257 |
| 920          | 2.00%    | 3.00%   |         159,484 |             0.5145 |
| **Subtotal** |          |         |                 |        **11.8592** |

### `528hi3StRe7uGjt99d35myh95JPc2MqBEHTPYcEhqMg5`

Bond inflation commission: 0%, on-chain commission: 5%.
Old code used 5% (on-chain), SDK used 0% (bond-capped) = false 5% increase detected.

| Epoch        | Expected | Charged | SAM Stake (SOL) | False Charge (SOL) |
| ------------ | -------- | ------- | --------------: | -----------------: |
| 922          | 0.00%    | 5.00%   |               0 |             0.0000 |
| 923          | 0.00%    | 5.00%   |               0 |             0.0000 |
| 924          | 0.00%    | 5.00%   |               0 |             0.0000 |
| 925          | 0.00%    | 5.00%   |          14,964 |             0.2412 |
| 926          | 0.00%    | 5.00%   |          36,808 |             0.5937 |
| 927          | 0.00%    | 5.00%   |          37,950 |             0.6128 |
| 928          | 0.00%    | 5.00%   |          38,216 |             0.6178 |
| 929          | 0.00%    | 5.00%   |          38,585 |             0.6240 |
| 930          | 0.00%    | 5.00%   |          38,570 |             0.6244 |
| **Subtotal** |          |         |                 |         **3.3137** |

### `Simpj3KyRQmpRkXuBvCQFS7DBBG6vqw93SkZb9UD1hp`

Bond inflation commission: 0%, on-chain commission: 5%.
Old code used 5% (on-chain), SDK used 0% (bond-capped) = false 5% increase detected.

| Epoch        | Expected | Charged | SAM Stake (SOL) | False Charge (SOL) |
| ------------ | -------- | ------- | --------------: | -----------------: |
| 928          | 0.00%    | 5.00%   |               0 |             0.0000 |
| 929          | 0.00%    | 5.00%   |          45,078 |             0.7289 |
| 930          | 0.00%    | 5.00%   |         120,000 |             1.9425 |
| **Subtotal** |          |         |                 |         **2.6715** |

### Grand Total

| Validator                                      | Epochs | Total False Charge (SOL) |
| ---------------------------------------------- | -----: | -----------------------: |
| `86Sw9R6ynPmXnHfwUWinXtq1QoF2KHesfQQyZG5r8sXo` |     19 |                  11.8592 |
| `528hi3StRe7uGjt99d35myh95JPc2MqBEHTPYcEhqMg5` |      9 |                   3.3137 |
| `Simpj3KyRQmpRkXuBvCQFS7DBBG6vqw93SkZb9UD1hp`  |      3 |                   2.6715 |
| **TOTAL**                                      | **31** |              **17.8445** |

## MEV False Positives (not charged)

22 MEV-only false positive entries were detected across 4 validators, but **none resulted in
an actual SOL charge**. The reason is in `analyze-revenue.cmd.ts` lines 233-238:

```typescript
// TODO: temporary fix for wrong value of MEV commission when there is no MEV data for epoch, skipping MEV for now
// const expectedNonBidPmpe = validatorBefore.revShare.inflationPmpe + validatorBefore.revShare.mevPmpe
// const actualNonBidPmpe = validatorAfter.revShare.inflationPmpe + validatorAfter.revShare.mevPmpe
const expectedNonBidPmpe = validatorBefore.revShare.inflationPmpe
const actualNonBidPmpe = validatorAfter.revShare.inflationPmpe
```

The `lossPerStake` is computed as `Math.max(0, expectedNonBidPmpe - actualNonBidPmpe) / 1000`.
Since `expectedNonBidPmpe` and `actualNonBidPmpe` only include `inflationPmpe` (MEV PMPE is
commented out), any MEV commission mismatch does not contribute to the loss calculation.

This was an intentional workaround for epochs where MEV data was unavailable or unreliable,
which would have caused validators without MEV data to appear as if they had 0% MEV commission
(and thus maximum MEV revenue share), inflating their PMPE and creating false charges.

### MEV-only false positive validators

| Validator                                      | Epochs              | Expected MEV | Actual MEV |
| ---------------------------------------------- | ------------------- | ------------ | ---------- |
| `Simpj3KyRQmpRkXuBvCQFS7DBBG6vqw93SkZb9UD1hp`  | 918-926 (9 epochs)  | 0.00%        | 10.00%     |
| `Fy6zNoZ1eCPpQX3JXeQ9Yd1HW1BFL8rrFmDvYYDnuxjT` | 925-930 (6 epochs)  | 0.00%        | 5.00%      |
| `THWfRpcJSC7oDrNMSCcixTZmCHVBTEVQL4qnd1UTD1x`  | 900-904 (5 epochs)  | 0.00%        | 7.90%      |
| `edu1fZt5i82cFm6ujUoyXLMdujWxZyWYC8fkydWHRNT`  | 918, 920 (2 epochs) | 4.00%        | 8.00%      |
