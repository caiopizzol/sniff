/**
 * Linear webhook parsing and verification
 */

import { createHmac } from 'node:crypto'
import { logger } from '@sniff/core'
import type { LinearWebhookEvent } from '@sniff/core'

export interface LinearWebhookPayload {
  action: string
  type: string
  data: {
    id: string
    identifier: string
    title: string
    description?: string
    teamId: string
    team?: {
      key: string
    }
    labels?: Array<{ name: string }>
    assigneeId?: string
    projectId?: string
  }
  createdAt: string
}

/**
 * Verify Linear webhook signature
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const hmac = createHmac('sha256', secret)
  hmac.update(payload)
  const expectedSignature = hmac.digest('hex')

  return signature === expectedSignature
}

/**
 * Parse Linear webhook payload into event
 * Returns null for unsupported webhook types
 */
export function parseWebhook(payload: LinearWebhookPayload): LinearWebhookEvent | null {
  // Only handle Issue webhooks
  if (payload.type !== 'Issue' || !payload.data?.id) {
    return null
  }

  const { data } = payload

  const event: LinearWebhookEvent = {
    type: 'linear',
    action: payload.action,
    payload,
    timestamp: new Date(payload.createdAt),
    data: {
      issueId: data.id,
      issueIdentifier: data.identifier,
      issueTitle: data.title,
      issueDescription: data.description,
      teamId: data.teamId,
      teamKey: data.team?.key ?? '',
      labels: data.labels?.map((l) => l.name) ?? [],
      assigneeId: data.assigneeId,
      projectId: data.projectId,
    },
  }

  logger.debug('Parsed LinearWebhookEvent', {
    action: event.action,
    data: event.data,
  })

  return event
}

