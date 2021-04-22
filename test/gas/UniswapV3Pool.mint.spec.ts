import { waffle } from 'hardhat'
import { Wallet, BigNumber, BigNumberish, ContractTransaction } from 'ethers'
import { MockTimeUniswapV3Pool } from '../../typechain/MockTimeUniswapV3Pool'
import { expect } from '../shared/expect'

import { poolFixture } from '../shared/fixtures'
import snapshotGasCost from '../shared/snapshotGasCost'

import {
  expandTo18Decimals,
  FeeAmount,
  getMinTick,
  encodePriceSqrt,
  TICK_SPACINGS,
  createPoolFunctions,
  SwapFunction,
  MintFunction,
  getMaxTick,
  MaxUint128,
} from '../shared/utilities'

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
}

const TEST_CASES : PoolTestCase[] = [
  {
    description: "init mint - price: 1 - fee: LOW - one position - range: -1000:1000, liq: 2000",
    feeAmount: FeeAmount.LOW,
    startingPrice: encodePriceSqrt(1, 1),
    tickSpacing: TICK_SPACINGS[FeeAmount.LOW],
    positions: [
      { 
        tickLower: -1000,
        tickUpper: 1000,
        liquidity: expandTo18Decimals(2000),
      },
    ]
  },
  {
    description: "init mint - price: 100 - fee: LOW - one position - range: -1000:1000, liq: 2000",
    feeAmount: FeeAmount.LOW,
    startingPrice: encodePriceSqrt(1, 1),
    tickSpacing: TICK_SPACINGS[FeeAmount.LOW],
    positions: [
      { 
        tickLower: -1000,
        tickUpper: 1000,
        liquidity: expandTo18Decimals(100),
      },
    ]
  },
  {
    description: "init mint - price: 100 - fee: LOW - one position - range: -100:100, liq: 2000",
    feeAmount: FeeAmount.LOW,
    startingPrice: encodePriceSqrt(1, 1),
    tickSpacing: TICK_SPACINGS[FeeAmount.LOW],
    positions: [
      { 
        tickLower: -100,
        tickUpper: 100,
        liquidity: expandTo18Decimals(100),
      },
    ]
  },
  {
    description: "two mints - second is the same",
    feeAmount: FeeAmount.LOW,
    startingPrice: encodePriceSqrt(1, 1),
    tickSpacing: TICK_SPACINGS[FeeAmount.LOW],
    positions: [
      { 
        tickLower: -100,
        tickUpper: 100,
        liquidity: expandTo18Decimals(100),
      },
      { 
        tickLower: -100,
        tickUpper: 100,
        liquidity: expandTo18Decimals(100),
      },
    ]
  },
  {
    description: "two mints - second is out of range",
    feeAmount: FeeAmount.LOW,
    startingPrice: encodePriceSqrt(1, 1),
    tickSpacing: TICK_SPACINGS[FeeAmount.LOW],
    positions: [
      { 
        tickLower: -100,
        tickUpper: 100,
        liquidity: expandTo18Decimals(100),
      },
      { 
        tickLower: 200,
        tickUpper: 300,
        liquidity: expandTo18Decimals(100),
      },
    ]
  },
  {
    description: "two mints - second is within the range",
    feeAmount: FeeAmount.LOW,
    startingPrice: encodePriceSqrt(1, 1),
    tickSpacing: TICK_SPACINGS[FeeAmount.LOW],
    positions: [
      { 
        tickLower: -100,
        tickUpper: 100,
        liquidity: expandTo18Decimals(100),
      },
      { 
        tickLower: -50,
        tickUpper: 50,
        liquidity: expandTo18Decimals(100),
      },
    ]
  },
]


const createFixtureLoader = waffle.createFixtureLoader

describe('UniswapV3Pool mint tests', () => {
  const [wallet, other] = waffle.provider.getWallets()

  let loadFixture: ReturnType<typeof createFixtureLoader>

  before('create fixture loader', async () => {
    loadFixture = createFixtureLoader([wallet, other])
  })

  // for (const feeProtocol of [0, 6]) {
  for (const feeProtocol of [0]) {
    
    describe(feeProtocol > 0 ? 'fee is on ('+feeProtocol+')' : 'fee is off', () => {
    
      for (const testCase of TEST_CASES) {

        describe(testCase.description, () => {
          
          const gasTestFixture = async ([wallet]: Wallet[]) => {
            const fix = await poolFixture([wallet], waffle.provider)
  
            const pool = await fix.createPool(testCase.feeAmount, testCase.tickSpacing)
  
            const { mint } = await createPoolFunctions({
              swapTarget: fix.swapTargetCallee,
              token0: fix.token0,
              token1: fix.token1,
              pool,
            })
  
            await pool.initialize(testCase.startingPrice)
            await pool.setFeeProtocol(feeProtocol, feeProtocol)
            await pool.increaseObservationCardinalityNext(4)
            await pool.advanceTime(1)
  
            return { pool, mint }
          }
  
          let pool: MockTimeUniswapV3Pool
          let mint: MintFunction
  
          beforeEach('load the fixture', async () => {
            ;({ pool, mint } = await loadFixture(gasTestFixture))
          })  
  
          it(testCase.description, async () => {
            for (const position of testCase.positions) {
              let tx = await mint(wallet.address, position.tickLower, position.tickUpper, position.liquidity);
              console.log('\t\tMint position #'+testCase.positions.indexOf(position)+':', (await tx.wait()).gasUsed.toString())
            }
          })
        })
      

      }
    })
  }
})
