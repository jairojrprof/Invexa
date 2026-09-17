import { createMarketHandler } from '../lib/market.js'
import { marketCache } from '../lib/market-cache.js'

export default createMarketHandler('quote', { cache: marketCache })
