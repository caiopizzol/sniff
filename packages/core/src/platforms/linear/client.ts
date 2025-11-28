/**
 * Linear GraphQL client
 *
 * Re-exports from @usepolvo/linear with Sniff-specific GraphQL queries.
 */

// Re-export Polvo's client and types
export {
  LinearClient,
  LinearApiError,
  type LinearClientConfig,
  type GraphQLResponse,
} from '@usepolvo/linear';

// ─────────────────────────────────────────────────────────────
// Sniff-specific GraphQL Queries
// These queries are specific to Sniff's needs and may be added
// to @usepolvo/linear in the future.
// ─────────────────────────────────────────────────────────────

export const QUERIES = {
  GET_ISSUE: `
    query GetIssue($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        priority
        priorityLabel
        url
        createdAt
        updatedAt
        state {
          id
          name
          type
          color
        }
        assignee {
          id
          name
          email
          avatarUrl
        }
        creator {
          id
          name
          email
        }
        team {
          id
          name
          key
        }
        project {
          id
          name
        }
        cycle {
          id
          name
          number
        }
        labels {
          nodes {
            id
            name
            color
          }
        }
        comments {
          nodes {
            id
            body
            createdAt
            user {
              id
              name
              email
              isMe
            }
          }
        }
      }
    }
  `,

  GET_AGENT_SESSION_ACTIVITIES: `
    query AgentSession($id: String!) {
      agentSession(id: $id) {
        activities {
          edges {
            node {
              updatedAt
              content {
                ... on AgentActivityPromptContent {
                  body
                }
                ... on AgentActivityThoughtContent {
                  body
                }
                ... on AgentActivityActionContent {
                  action
                  parameter
                  result
                }
                ... on AgentActivityElicitationContent {
                  body
                }
                ... on AgentActivityResponseContent {
                  body
                }
                ... on AgentActivityErrorContent {
                  body
                }
              }
            }
          }
        }
      }
    }
  `,

  CREATE_COMMENT: `
    mutation CreateComment($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success
        comment {
          id
          body
        }
      }
    }
  `,

  CREATE_AGENT_ACTIVITY: `
    mutation CreateAgentActivity($sessionId: String!, $content: JSONObject!) {
      agentActivityCreate(
        input: {
          agentSessionId: $sessionId
          content: $content
        }
      ) {
        success
        agentActivity {
          id
        }
      }
    }
  `,
};
