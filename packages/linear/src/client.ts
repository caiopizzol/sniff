/**
 * Linear GraphQL client that relays requests through the proxy
 *
 * New architecture:
 * - All API calls go through the proxy via WebSocket
 * - Proxy uses org's agent token for authentication
 * - CLI never holds the org token
 */

import type { ConnectionClient } from '@sniff/connection'
import type { ActivityContent } from './agent-session'

export interface LinearClientOptions {
  connection: ConnectionClient
}

interface GraphQLResponse<T> {
  data: T
  errors?: Array<{ message: string }>
}

export class LinearClient {
  private connection: ConnectionClient

  constructor(options: LinearClientOptions) {
    this.connection = options.connection
  }

  /**
   * Execute a GraphQL query through the proxy
   */
  private async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await this.connection.apiCall<GraphQLResponse<T>>('/graphql', {
      method: 'POST',
      body: { query, variables },
    })

    if (response.errors?.length) {
      throw new Error(response.errors[0].message)
    }

    return response.data
  }

  /**
   * Get an issue by ID with labels and team
   */
  async getIssue(issueId: string) {
    const data = await this.query<{
      issue: {
        id: string
        identifier: string
        title: string
        description: string | null
        state: { id: string; name: string }
        assignee: { id: string; name: string } | null
        team: { id: string; key: string; name: string }
        labels: { nodes: Array<{ id: string; name: string }> }
      }
    }>(
      `query GetIssue($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          description
          state { id name }
          assignee { id name }
          team { id key name }
          labels { nodes { id name } }
        }
      }`,
      { id: issueId },
    )
    return data.issue
  }

  /**
   * Get the current user
   */
  async getCurrentUser() {
    const data = await this.query<{
      viewer: {
        id: string
        email: string
        name: string
        admin: boolean
      }
    }>(
      `query GetViewer {
        viewer {
          id
          email
          name
          admin
        }
      }`,
    )
    return data.viewer
  }

  /**
   * Create a comment on an issue
   */
  async createComment(issueId: string, body: string) {
    const data = await this.query<{
      commentCreate: {
        success: boolean
        comment: { id: string }
      }
    }>(
      `mutation CreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment { id }
        }
      }`,
      { input: { issueId, body } },
    )
    return data.commentCreate
  }

  /**
   * Update an issue
   */
  async updateIssue(issueId: string, data: { stateId?: string; assigneeId?: string }) {
    const result = await this.query<{
      issueUpdate: {
        success: boolean
        issue: { id: string }
      }
    }>(
      `mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue { id }
        }
      }`,
      { id: issueId, input: data },
    )
    return result.issueUpdate
  }

  /**
   * Send an agent activity to a session
   * Used for Linear Agents API to report progress/results
   * @param ephemeral - If true, activity auto-replaces when next activity arrives (only for thought/action)
   */
  async sendAgentActivity(
    sessionId: string,
    content: ActivityContent,
    ephemeral?: boolean,
  ): Promise<void> {
    await this.query<{
      agentActivityCreate: { success: boolean }
    }>(
      `mutation CreateAgentActivity($input: AgentActivityCreateInput!) {
        agentActivityCreate(input: $input) {
          success
        }
      }`,
      {
        input: {
          agentSessionId: sessionId,
          content,
          ephemeral,
        },
      },
    )
  }

  /**
   * Send a thought activity (for immediate acknowledgment)
   */
  async sendThought(sessionId: string, body: string): Promise<void> {
    await this.sendAgentActivity(sessionId, { type: 'thought', body })
  }

  /**
   * Send an ephemeral thought activity (auto-replaces when next activity arrives)
   * Use for live thinking/progress that doesn't need to persist
   */
  async sendEphemeralThought(sessionId: string, body: string): Promise<void> {
    await this.sendAgentActivity(sessionId, { type: 'thought', body }, true)
  }

  /**
   * Send an action activity (for tool usage)
   */
  async sendAction(
    sessionId: string,
    action: string,
    parameter: string,
    result?: string,
  ): Promise<void> {
    await this.sendAgentActivity(sessionId, { type: 'action', action, parameter, result })
  }

  /**
   * Send a response activity (for final result)
   */
  async sendResponse(sessionId: string, body: string): Promise<void> {
    await this.sendAgentActivity(sessionId, { type: 'response', body })
  }

  /**
   * Send an error activity
   */
  async sendError(sessionId: string, body: string): Promise<void> {
    await this.sendAgentActivity(sessionId, { type: 'error', body })
  }
}
