/**
 * Linear attachment pre-fetching
 *
 * Fetches files from uploads.linear.app URLs using OAuth authentication
 * before sending them to the agent.
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { logger } from '@sniff/core'
import type { AgentSessionEvent } from './agent-session'

export interface FetchedAttachment {
  url: string
  success: boolean
  contentType?: string
  /** Local file path where the attachment was saved */
  localPath?: string
  error?: string
}

/**
 * Extract uploads.linear.app URLs from text
 */
export function extractLinearUploadUrls(text: string): string[] {
  const regex = /https:\/\/uploads\.linear\.app\/[^\s)>\]"']+/g
  return [...new Set(text.match(regex) || [])]
}

/**
 * Fetch a single attachment with OAuth authentication
 * All files are saved to the worktree for the agent to read
 */
export async function fetchLinearAttachment(
  url: string,
  accessToken: string,
  worktreePath: string,
): Promise<FetchedAttachment> {
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      return { url, success: false, error: `HTTP ${response.status}` }
    }

    const contentType = response.headers.get('content-type') || ''

    // Save all files to worktree - agent can read PDFs, images, text, etc.
    const filename = url.split('/').pop() || `attachment-${Date.now()}`
    const attachmentsDir = join(worktreePath, '.sniff-attachments')
    await mkdir(attachmentsDir, { recursive: true })

    const localPath = join(attachmentsDir, filename)
    const buffer = await response.arrayBuffer()
    await Bun.write(localPath, buffer)

    return { url, success: true, contentType, localPath }
  } catch (error) {
    return { url, success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Pre-fetch all Linear attachments from an agent session event
 */
export async function prefetchLinearAttachments(
  event: AgentSessionEvent,
  accessToken: string,
  worktreePath: string,
): Promise<FetchedAttachment[]> {
  // Extract URLs from promptContext and issue description
  const textToSearch = [event.promptContext, event.issue.description || ''].join('\n')

  const urls = extractLinearUploadUrls(textToSearch)

  if (urls.length === 0) return []

  logger.debug('Pre-fetching Linear attachments', { count: urls.length })

  // Fetch all in parallel
  const results = await Promise.all(
    urls.map((url) => fetchLinearAttachment(url, accessToken, worktreePath)),
  )

  // Log any failures
  for (const result of results) {
    if (!result.success) {
      logger.warn('Failed to fetch attachment', { url: result.url, error: result.error })
    }
  }

  return results
}

/**
 * Format fetched attachments for inclusion in the prompt
 */
export function formatAttachmentsForPrompt(attachments: FetchedAttachment[]): string {
  const successful = attachments.filter((a) => a.success)
  if (successful.length === 0) return ''

  const sections: string[] = ['\n---\n## Attachments\n']
  sections.push('The following files have been downloaded. Use the Read tool to view them:\n')

  for (const att of successful) {
    const filename = att.url.split('/').pop() || 'attachment'
    sections.push(`- **${filename}**: ${att.localPath}`)
  }

  sections.push('')
  return sections.join('\n')
}
