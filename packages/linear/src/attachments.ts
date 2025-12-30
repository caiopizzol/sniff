/**
 * Linear attachment pre-fetching
 *
 * Fetches files from uploads.linear.app URLs using OAuth authentication
 * and attachment metadata (Slack messages, etc.) via GraphQL.
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
  /** True if file was intentionally skipped (video, audio, etc.) */
  skipped?: boolean
  /** Reason the file was skipped */
  skipReason?: string
  /** Original filename */
  filename?: string
  /** File size in bytes if known */
  fileSize?: number
}

export interface AttachmentMessage {
  body: string
  author: string
  timestamp?: string
}

export interface AttachmentMetadata {
  title: string
  url: string
  source?: { type: string }
  messages: AttachmentMessage[]
}

export interface RelatedIssue {
  identifier: string
  title: string
  relationType: 'blocks' | 'blockedBy' | 'duplicate' | 'duplicateOf' | 'related'
}

// Media types that Claude cannot process
const VIDEO_MIME_PREFIXES = ['video/']
const AUDIO_MIME_PREFIXES = ['audio/']
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.mpeg', '.m4v']
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']

function isUnreadableMedia(contentType: string, filename: string): boolean {
  const lowerContentType = contentType.toLowerCase()
  const mimeMatch =
    VIDEO_MIME_PREFIXES.some((p) => lowerContentType.startsWith(p)) ||
    AUDIO_MIME_PREFIXES.some((p) => lowerContentType.startsWith(p))
  if (mimeMatch) return true

  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] || ''
  return VIDEO_EXTENSIONS.includes(ext) || AUDIO_EXTENSIONS.includes(ext)
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
 * Videos and audio files are skipped since Claude cannot process them
 */
export async function fetchLinearAttachment(
  url: string,
  accessToken: string,
  worktreePath: string,
): Promise<FetchedAttachment> {
  const filename = url.split('/').pop() || `attachment-${Date.now()}`

  try {
    // HEAD request first to check content type without downloading
    const headResponse = await fetch(url, {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!headResponse.ok) {
      return { url, success: false, error: `HTTP ${headResponse.status}`, filename }
    }

    const contentType = headResponse.headers.get('content-type') || ''
    const contentLength = headResponse.headers.get('content-length')
    const fileSize = contentLength ? parseInt(contentLength, 10) : undefined

    // Skip video/audio files - Claude cannot process them
    if (isUnreadableMedia(contentType, filename)) {
      return {
        url,
        success: true,
        contentType,
        skipped: true,
        skipReason: 'video/audio files cannot be processed by the agent',
        filename,
        fileSize,
      }
    }

    // Download the file
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      return { url, success: false, error: `HTTP ${response.status}`, filename }
    }

    // Save to worktree - agent can read PDFs, images, text, etc.
    const attachmentsDir = join(worktreePath, '.sniff-attachments')
    await mkdir(attachmentsDir, { recursive: true })

    const localPath = join(attachmentsDir, filename)
    const buffer = await response.arrayBuffer()
    await Bun.write(localPath, buffer)

    return { url, success: true, contentType, localPath, filename, fileSize }
  } catch (error) {
    return { url, success: false, error: error instanceof Error ? error.message : String(error), filename }
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
  const downloaded = attachments.filter((a) => a.success && !a.skipped)
  const skipped = attachments.filter((a) => a.success && a.skipped)

  if (downloaded.length === 0 && skipped.length === 0) return ''

  const sections: string[] = ['\n---\n## Attachments\n']

  if (downloaded.length > 0) {
    sections.push('The following files have been downloaded. Use the Read tool to view them:\n')
    for (const att of downloaded) {
      const filename = att.filename || att.url.split('/').pop() || 'attachment'
      sections.push(`- **${filename}**: ${att.localPath}`)
    }
    sections.push('')
  }

  if (skipped.length > 0) {
    sections.push('The following files could not be processed (for reference only):\n')
    for (const att of skipped) {
      const size = att.fileSize ? ` (${formatFileSize(att.fileSize)})` : ''
      sections.push(`- **${att.filename}**${size}: ${att.skipReason}`)
    }
    sections.push('')
  }

  return sections.join('\n')
}

/**
 * Fetch attachment metadata from Linear GraphQL API
 */
export async function fetchAttachmentMetadata(
  issueId: string,
  accessToken: string,
): Promise<AttachmentMetadata[]> {
  const query = `query($id: String!) {
    issue(id: $id) {
      attachments {
        nodes {
          title
          url
          metadata
          source
        }
      }
    }
  }`

  try {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query, variables: { id: issueId } }),
    })

    const result = (await response.json()) as {
      data?: {
        issue?: {
          attachments?: {
            nodes?: Array<{
              title: string
              url: string
              metadata?: { messages?: AttachmentMessage[] }
              source?: { type: string }
            }>
          }
        }
      }
    }

    const nodes = result.data?.issue?.attachments?.nodes || []

    return nodes
      .filter((n) => n.metadata?.messages?.length)
      .map((n) => ({
        title: n.title,
        url: n.url,
        source: n.source,
        messages: n.metadata!.messages!,
      }))
  } catch (error) {
    logger.warn('Failed to fetch attachment metadata', { issueId, error })
    return []
  }
}

/**
 * Format attachment messages for inclusion in the prompt
 */
export function formatAttachmentMessagesForPrompt(attachments: AttachmentMetadata[]): string {
  if (attachments.length === 0) return ''

  const sections: string[] = ['\n---\n## Customer Requests\n']

  for (const att of attachments) {
    const sourceType = att.source?.type || 'unknown'

    for (const msg of att.messages) {
      const date = msg.timestamp ? new Date(msg.timestamp).toLocaleDateString() : ''
      const header = date ? `**${msg.author}** (${sourceType}, ${date}):` : `**${msg.author}** (${sourceType}):`
      sections.push(header)
      sections.push(`> ${msg.body.split('\n').join('\n> ')}\n`)
    }
  }

  return sections.join('\n')
}

/**
 * Fetch issue relations (blocking, blocked-by, duplicates, related) from Linear GraphQL API
 */
export async function fetchIssueRelations(
  issueId: string,
  accessToken: string,
): Promise<RelatedIssue[]> {
  const query = `query($id: String!) {
    issue(id: $id) {
      id
      relations {
        nodes {
          type
          issue { id identifier title }
          relatedIssue { id identifier title }
        }
      }
    }
  }`

  try {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query, variables: { id: issueId } }),
    })

    const result = (await response.json()) as {
      data?: {
        issue?: {
          id: string
          relations?: {
            nodes?: Array<{
              type: string
              issue: { id: string; identifier: string; title: string }
              relatedIssue: { id: string; identifier: string; title: string }
            }>
          }
        }
      }
    }

    const currentIssueId = result.data?.issue?.id
    const nodes = result.data?.issue?.relations?.nodes || []

    return nodes.map((rel) => {
      // Determine relationship direction based on which side is the current issue
      const isCurrentIssueSource = rel.issue.id === currentIssueId
      const otherIssue = isCurrentIssueSource ? rel.relatedIssue : rel.issue

      let relationType: RelatedIssue['relationType']
      switch (rel.type) {
        case 'blocks':
          // If current issue is source, it blocks the other; otherwise it's blocked by
          relationType = isCurrentIssueSource ? 'blocks' : 'blockedBy'
          break
        case 'duplicate':
          relationType = isCurrentIssueSource ? 'duplicate' : 'duplicateOf'
          break
        default:
          relationType = 'related'
      }

      return {
        identifier: otherIssue.identifier,
        title: otherIssue.title,
        relationType,
      }
    })
  } catch (error) {
    logger.warn('Failed to fetch issue relations', { issueId, error })
    return []
  }
}

/**
 * Format related issues for inclusion in the prompt
 */
export function formatRelatedIssuesForPrompt(relations: RelatedIssue[]): string {
  if (relations.length === 0) return ''

  const sections: string[] = ['\n---\n## Related Issues\n']
  sections.push('Use the Linear MCP server to fetch full details if needed:\n')

  // Group by relation type
  const blocking = relations.filter((r) => r.relationType === 'blocks')
  const blockedBy = relations.filter((r) => r.relationType === 'blockedBy')
  const duplicates = relations.filter(
    (r) => r.relationType === 'duplicate' || r.relationType === 'duplicateOf',
  )
  const related = relations.filter((r) => r.relationType === 'related')

  if (blockedBy.length > 0) {
    sections.push('**Blocked by:**')
    for (const r of blockedBy) {
      sections.push(`- ${r.identifier}: ${r.title}`)
    }
    sections.push('')
  }

  if (blocking.length > 0) {
    sections.push('**Blocking:**')
    for (const r of blocking) {
      sections.push(`- ${r.identifier}: ${r.title}`)
    }
    sections.push('')
  }

  if (duplicates.length > 0) {
    sections.push('**Duplicates:**')
    for (const r of duplicates) {
      sections.push(`- ${r.identifier}: ${r.title}`)
    }
    sections.push('')
  }

  if (related.length > 0) {
    sections.push('**Related:**')
    for (const r of related) {
      sections.push(`- ${r.identifier}: ${r.title}`)
    }
    sections.push('')
  }

  return sections.join('\n')
}
