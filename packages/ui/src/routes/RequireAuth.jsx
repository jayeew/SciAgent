import { useAuth } from '@/hooks/useAuth'
import { useConfig } from '@/store/context/ConfigContext'
import PropTypes from 'prop-types'
import { useSelector } from 'react-redux'
import { Navigate } from 'react-router'
import { useLocation } from 'react-router-dom'

/**
 * Checks if a feature flag is enabled
 * @param {Object} features - Feature flags object
 * @param {string} display - Feature flag key to check
 * @param {React.ReactElement} children - Components to render if feature is enabled
 * @returns {React.ReactElement} Children or unauthorized redirect
 */
const checkFeatureFlag = (features, display, children, location, permission) => {
    const unauthorizedState = {
        path: location.pathname,
        reason: 'feature_not_available',
        requiredFeature: display,
        requiredPermission: permission
    }

    // Validate features object exists and is properly formatted
    if (!features || Array.isArray(features) || Object.keys(features).length === 0) {
        return <Navigate to='/unauthorized' replace state={unauthorizedState} />
    }

    // Check if feature flag exists and is enabled
    if (Object.hasOwnProperty.call(features, display)) {
        const isFeatureEnabled = features[display] === 'true' || features[display] === true
        return isFeatureEnabled ? children : <Navigate to='/unauthorized' replace state={unauthorizedState} />
    }

    return <Navigate to='/unauthorized' replace state={unauthorizedState} />
}

export const RequireAuth = ({ permission, display, children }) => {
    const location = useLocation()
    const { isCloud, isOpenSource, isEnterpriseLicensed, loading } = useConfig()
    const { hasPermission } = useAuth()
    const isGlobal = useSelector((state) => state.auth.isGlobal)
    const currentUser = useSelector((state) => state.auth.user)
    const features = useSelector((state) => state.auth.features)
    const permissions = useSelector((state) => state.auth.permissions)
    const getUnauthorizedState = (reason) => ({
        path: location.pathname,
        reason,
        requiredPermission: permission,
        requiredFeature: display
    })

    // Step 0: Wait for config to load
    if (loading) {
        return null
    }

    // Step 1: Authentication Check
    // Redirect to login if user is not authenticated
    if (!currentUser) {
        return <Navigate to='/login' replace state={{ path: location.pathname }} />
    }

    // Step 2: Deployment Type Specific Logic
    // Open Source: owner can access display-gated pages; others are denied
    if (isOpenSource) {
        if (display === 'feat:sso-config') {
            return <Navigate to='/unauthorized' replace state={getUnauthorizedState('enterprise_only_feature')} />
        }
        if (display) {
            return isGlobal ? children : <Navigate to='/unauthorized' replace state={getUnauthorizedState('owner_required')} />
        }
        return children
    }

    // Cloud & Enterprise: Check both permissions and feature flags
    if (isCloud || isEnterpriseLicensed) {
        // Routes with display property - check feature flags
        if (display) {
            // Organization admins bypass permission checks
            if (isGlobal) {
                return checkFeatureFlag(features, display, children, location, permission)
            }

            // Check if user has any permissions
            if (!Array.isArray(permissions) || permissions.length === 0) {
                return <Navigate to='/unauthorized' replace state={getUnauthorizedState('no_permissions_assigned')} />
            }

            // Check user permissions and feature flags
            if (!permission || hasPermission(permission)) {
                return checkFeatureFlag(features, display, children, location, permission)
            }

            return <Navigate to='/unauthorized' replace state={getUnauthorizedState('missing_permission')} />
        }

        // Standard routes: check permissions (global admins bypass)
        if (permission && !hasPermission(permission) && !isGlobal) {
            return <Navigate to='/unauthorized' replace state={getUnauthorizedState('missing_permission')} />
        }

        return children
    }

    // Fallback: If none of the platform types match, deny access
    return <Navigate to='/unauthorized' replace state={getUnauthorizedState('access_denied')} />
}

RequireAuth.propTypes = {
    permission: PropTypes.string,
    display: PropTypes.string,
    children: PropTypes.element
}
