import { PermissionRequest } from './structured/PermissionRequest'
import { CredentialRequest } from './structured/CredentialRequest'
import { AdminApprovalRequest } from './structured/AdminApprovalRequest'
import type { StructuredInputState, StructuredResponse } from './structured/types'

interface StructuredInputProps {
  state: StructuredInputState
  onResponse: (response: StructuredResponse) => void | Promise<void>
  /** When true, removes container styling (shadow, bg, rounded) - used when wrapped by InputContainer */
  unstyled?: boolean
}

/**
 * StructuredInput - Router component for structured input UIs
 *
 * Routes to the appropriate component based on the input type:
 * - permission: PermissionRequest (bash command approval)
 * - credential: CredentialRequest (secure auth input)
 */
export function StructuredInput({ state, onResponse, unstyled = false }: StructuredInputProps) {
  switch (state.type) {
    case 'permission':
      return (
        <PermissionRequest
          key={state.data.requestId}
          request={state.data}
          onResponse={onResponse}
          unstyled={unstyled}
        />
      )
    case 'credential':
      return (
        <CredentialRequest
          request={state.data}
          onResponse={onResponse}
          unstyled={unstyled}
        />
      )
    case 'admin_approval':
      return (
        <AdminApprovalRequest
          key={state.data.requestId}
          request={state.data}
          onApprove={({ rememberForMinutes }) => onResponse({ type: 'admin_approval', approved: true, rememberForMinutes })}
          onCancel={() => onResponse({ type: 'admin_approval', approved: false })}
          unstyled={unstyled}
        />
      )
    default:
      return null
  }
}
