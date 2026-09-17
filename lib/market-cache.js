import { getCache } from '@vercel/functions'
import { createHash } from 'node:crypto'

const options = { namespace: 'invexa-market-v1', keyHashFunction: key => createHash('sha256').update(key).digest('hex') }
async function bounded(operation) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cache timeout')), 750) })
    ])
  } finally { clearTimeout(timer) }
}

export const marketCache = {
  get: key => bounded(() => getCache(options).get(key)),
  set: (key, value, entryOptions) => bounded(() => getCache(options).set(key, value, entryOptions))
}
