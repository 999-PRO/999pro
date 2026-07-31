import type { Request, Response, NextFunction, RequestHandler } from 'express'

// Tiny async handler wrapper that forwards thrown errors to Express error middleware.
// Avoids repetitive try/catch in every route.
export type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<any> | any

export const asyncHandler =
  (fn: AsyncRequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next)
