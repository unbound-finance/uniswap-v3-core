import bn from 'bignumber.js'
import { Decimal } from 'decimal.js'
import { Wallet, BigNumber, BigNumberish, ContractTransaction } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { MockTimeUniswapV3Pool } from '../../typechain/MockTimeUniswapV3Pool'
import { TestERC20 } from '../../typechain/TestERC20'

import { TestUniswapV3Callee } from '../../typechain/TestUniswapV3Callee'
import { expect } from '../shared/expect'
import { poolFixture } from '../shared/fixtures'
import { formatPrice, formatTokenAmount } from '../shared/format'
import {
  createPoolFunctions,
  encodePriceSqrt,
  expandTo18Decimals,
  FeeAmount,
  getMaxLiquidityPerTick,
  getMaxTick,
  getMinTick,
  MAX_SQRT_RATIO,
  MaxUint128,
  MIN_SQRT_RATIO,
  TICK_SPACINGS,
} from '../shared/utilities'

Decimal.config({ toExpNeg: -500, toExpPos: 500 })

const createFixtureLoader = waffle.createFixtureLoader
const { constants } = ethers

interface BaseSwapTestCase {
  description: string,
  zeroForOne: boolean
  sqrtPriceLimit?: BigNumber
}
interface SwapExact0For1TestCase extends BaseSwapTestCase {
  zeroForOne: true
  exactOut: false
  amount0: BigNumberish
  sqrtPriceLimit?: BigNumber
}
interface SwapExact1For0TestCase extends BaseSwapTestCase {
  zeroForOne: false
  exactOut: false
  amount1: BigNumberish
  sqrtPriceLimit?: BigNumber
}
interface Swap0ForExact1TestCase extends BaseSwapTestCase {
  zeroForOne: true
  exactOut: true
  amount1: BigNumberish
  sqrtPriceLimit?: BigNumber
}
interface Swap1ForExact0TestCase extends BaseSwapTestCase {
  zeroForOne: false
  exactOut: true
  amount0: BigNumberish
  sqrtPriceLimit?: BigNumber
}
interface SwapToHigherPrice extends BaseSwapTestCase {
  zeroForOne: false
  sqrtPriceLimit: BigNumber
}
interface SwapToLowerPrice extends BaseSwapTestCase {
  zeroForOne: true
  sqrtPriceLimit: BigNumber
}
type SwapTestCase =
  | SwapExact0For1TestCase
  | Swap0ForExact1TestCase
  | SwapExact1For0TestCase
  | Swap1ForExact0TestCase
  | SwapToHigherPrice
  | SwapToLowerPrice

function swapCaseToDescription(testCase: SwapTestCase): string {
  if (testCase.description) {
    return testCase.description;
  }
  const priceClause = testCase?.sqrtPriceLimit ? ` to price ${formatPrice(testCase.sqrtPriceLimit)}` : ''
  if ('exactOut' in testCase) {
    if (testCase.exactOut) {
      if (testCase.zeroForOne) {
        return `swap token0 for exactly ${formatTokenAmount(testCase.amount1)} token1${priceClause}`
      } else {
        return `swap token1 for exactly ${formatTokenAmount(testCase.amount0)} token0${priceClause}`
      }
    } else {
      if (testCase.zeroForOne) {
        return `swap exactly ${formatTokenAmount(testCase.amount0)} token0 for token1${priceClause}`
      } else {
        return `swap exactly ${formatTokenAmount(testCase.amount1)} token1 for token0${priceClause}`
      }
    }
  } else {
    if (testCase.zeroForOne) {
      return `swap token0 for token1${priceClause}`
    } else {
      return `swap token1 for token0${priceClause}`
    }
  }
}

type PoolFunctions = ReturnType<typeof createPoolFunctions>

// can't use address zero because the ERC20 token does not allow it
const SWAP_RECIPIENT_ADDRESS = constants.AddressZero.slice(0, -1) + '1'
const POSITION_PROCEEDS_OUTPUT_ADDRESS = constants.AddressZero.slice(0, -1) + '2'

async function executeSwap(
  pool: MockTimeUniswapV3Pool,
  testCase: SwapTestCase,
  poolFunctions: PoolFunctions
): Promise<ContractTransaction> {
  let swap: ContractTransaction
  if ('exactOut' in testCase) {
    if (testCase.exactOut) {
      if (testCase.zeroForOne) {
        swap = await poolFunctions.swap0ForExact1(testCase.amount1, SWAP_RECIPIENT_ADDRESS, testCase.sqrtPriceLimit)
      } else {
        swap = await poolFunctions.swap1ForExact0(testCase.amount0, SWAP_RECIPIENT_ADDRESS, testCase.sqrtPriceLimit)
      }
    } else {
      if (testCase.zeroForOne) {
        swap = await poolFunctions.swapExact0For1(testCase.amount0, SWAP_RECIPIENT_ADDRESS, testCase.sqrtPriceLimit)
      } else {
        swap = await poolFunctions.swapExact1For0(testCase.amount1, SWAP_RECIPIENT_ADDRESS, testCase.sqrtPriceLimit)
      }
    }
  } else {
    if (testCase.zeroForOne) {
      swap = await poolFunctions.swapToLowerPrice(testCase.sqrtPriceLimit, SWAP_RECIPIENT_ADDRESS)
    } else {
      swap = await poolFunctions.swapToHigherPrice(testCase.sqrtPriceLimit, SWAP_RECIPIENT_ADDRESS)
    }
  }
  return swap
}

const DEFAULT_POOL_SWAP_TESTS: SwapTestCase[] = []

interface Position {
  tickLower: number
  tickUpper: number
  liquidity: BigNumberish
}

interface PoolTestCase {
  description: string
  feeAmount: number
  tickSpacing: number
  startingPrice: BigNumber
  positions: Position[]
  swapTests?: SwapTestCase[]
}

bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 })

function decodeSqrtPrice(sqrtPrice : BigNumber) : BigNumber {
  return BigNumber.from(
    new bn(sqrtPrice.toString())
      .div(new bn(2).pow(96))
      .pow(2)
      .multipliedBy(new bn(10).pow(18))
      .integerValue(3)
      .toString()
  )
}

function decodeBigNumberWithDecimals(value : BigNumber) : string {
  let tmp : BigNumber = value.mul(10000).div(expandTo18Decimals(1))
  return tmp.div(10000).toString() + "." + tmp.mod(10000).toString()
}

let TEST_POOLS: PoolTestCase[] = [
  {
    description: 'ETH/DAI one bucket - starting price: 1500 DAI - liquidity: range(1000 DAI ,2000 DAI), reserves(1 ETH,2054 DAI)',
    feeAmount: FeeAmount.LOW,
    tickSpacing: TICK_SPACINGS[FeeAmount.LOW],
    startingPrice: encodePriceSqrt(1500, 1),
    positions: [
      {
        tickLower: 69080, // tick for price 1000
        tickUpper: 76010, // tick for price 2000
        liquidity: expandTo18Decimals(289), // added liquidity L = sqrt(83566)
      },
    ],
    swapTests: [
      {
        description: "swap 2055 DAI without price limit to empty DAI liquidity",
        exactOut: true,
        zeroForOne: true,
        amount1: expandTo18Decimals(2055),
      },
    ],
  }
]

describe('UniswapV3Pool swap tests', () => {
  const [wallet, other] = waffle.provider.getWallets()

  let loadFixture: ReturnType<typeof createFixtureLoader>

  before('create fixture loader', async () => {
    loadFixture = createFixtureLoader([wallet, other])
  })

  // for (const feeProtocol of [0, 6]) {
  for (const feeProtocol of [0]) {
    
    describe(feeProtocol > 0 ? 'fee is on ('+feeProtocol+')' : 'fee is off', () => {
    
      for (const poolCase of TEST_POOLS) {
        describe(poolCase.description, () => {
          
          const poolCaseFixture = async () => {
            const { createPool, token0, token1, swapTargetCallee: swapTarget } = await poolFixture(
              [wallet],
              waffle.provider
            )
            const pool = await createPool(poolCase.feeAmount, poolCase.tickSpacing)
            const poolFunctions = createPoolFunctions({ swapTarget, token0, token1, pool })
            await pool.initialize(poolCase.startingPrice)

            const [poolBalance0BeforeMint, poolBalance1BeforeMint, poolSqrtPriceBefore] = await Promise.all([
              token0.balanceOf(pool.address),
              token1.balanceOf(pool.address),
              (await pool.slot0()).sqrtPriceX96,
            ])

            console.log("\t ... minting ...")
            // mint all positions
            for (const position of poolCase.positions) {
              let tx = await poolFunctions.mint(wallet.address, position.tickLower, position.tickUpper, position.liquidity)
            }

            const [poolBalance0AfterMint, poolBalance1AfterMint, poolSqrtPriceAfter] = await Promise.all([
              token0.balanceOf(pool.address),
              token1.balanceOf(pool.address),
              (await pool.slot0()).sqrtPriceX96,
            ])

            return { token0, token1, pool, poolFunctions, poolBalance0, poolBalance1, swapTarget }
          }

          let token0: TestERC20
          let token1: TestERC20

          let poolBalance0: BigNumber
          let poolBalance1: BigNumber

          let pool: MockTimeUniswapV3Pool
          let swapTarget: TestUniswapV3Callee
          let poolFunctions: PoolFunctions
  
          beforeEach('load the fixture', async () => {
            ;({ token0, token1, pool, poolFunctions, poolBalance0, poolBalance1, swapTarget } = await loadFixture(
              poolCaseFixture
            ))
          })  

          it("swap and collect", async () => {
            
            console.log("\t ... swaping ...")
            
            for (const testCase of poolCase.swapTests ?? DEFAULT_POOL_SWAP_TESTS) {
              const tx = executeSwap(pool, testCase, poolFunctions)

              await tx;
    
              const [poolBalance0AfterSwap, poolBalance1AfterSwap, poolSqrtPriceSwap] = await Promise.all([
                token0.balanceOf(pool.address),
                token1.balanceOf(pool.address),
                (await pool.slot0()).sqrtPriceX96,
              ])

            }
            console.log("\t ... burning & collecting ...")
  
            for (const position of poolCase.positions) {
              let txBurn = pool.burn(position.tickLower, position.tickUpper, position.liquidity)
              console.log('\tBurn:', (await (await txBurn).wait()).gasUsed.toString())
              let txCollect = pool.collect(wallet.address, position.tickLower, position.tickUpper, MaxUint128,MaxUint128)
              console.log('\tCollect:', (await (await txCollect).wait()).gasUsed.toString())
            }
          })

        })
      

      }
    })
  }
})
