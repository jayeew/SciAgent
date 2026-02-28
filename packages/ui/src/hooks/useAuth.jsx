import { useSelector } from 'react-redux'
import { useConfig } from '@/store/context/ConfigContext'

export const useAuth = () => {
    const { isOpenSource } = useConfig()
    const permissions = useSelector((state) => state.auth.permissions)
    const features = useSelector((state) => state.auth.features)
    const isGlobal = useSelector((state) => state.auth.isGlobal)
    const currentUser = useSelector((state) => state.auth.user)

    const hasPermission = (permissionId) => {
        // Owner (isGlobal) has full access in all modes
        if (isGlobal) return true
        // Open Source non-owners: check permissions array (so User & Workspace Management only for owner)
        // Enterprise/Cloud: always check permissions array
        if (!permissionId) return false
        const permissionIds = permissionId.split(',')
        if (permissions && permissions.length) {
            return permissionIds.some((pid) => permissions.includes(pid))
        }
        return false
    }

    const hasAssignedWorkspace = (workspaceId) => {
        if (isGlobal) return true
        const activeWorkspaceId = currentUser?.activeWorkspaceId || ''
        return workspaceId === activeWorkspaceId
    }

    const hasDisplay = (display) => {
        if (!display) {
            return true
        }

        // SSO Config is Enterprise-only. Backend blocks it in Open Source.
        if (isOpenSource && display === 'feat:sso-config') {
            return false
        }

        // In Open Source, global owner can access display-gated features.
        // In Cloud/Enterprise, display flags must still follow backend plan features.
        if (isGlobal && isOpenSource) {
            return true
        }

        // if it has display flag, but user has no features, then it should not be displayed
        if (!features || Array.isArray(features) || Object.keys(features).length === 0) {
            return false
        }

        // check if the display flag is in the features
        if (Object.hasOwnProperty.call(features, display)) {
            const flag = features[display] === 'true' || features[display] === true
            return flag
        }

        return false
    }

    return { hasPermission, hasAssignedWorkspace, hasDisplay }
}
