import { httpApi, type Api } from './httpApi'
import { mockApi } from './mockApi'

export { ApiError, LOCKED_EVENT, UNAUTHORIZED_EVENT } from './httpApi'

/** `npm run dev:mock` runs the UI against in-memory data instead of the server. */
export const MOCK_MODE = import.meta.env.VITE_MOCK === '1'

export const api: Api = MOCK_MODE ? mockApi : httpApi
