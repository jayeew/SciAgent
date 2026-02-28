import MainCard from '@/ui-component/cards/MainCard'
import { Box, Stack, Typography } from '@mui/material'
import unauthorizedSVG from '@/assets/images/unauthorized.svg'
import { StyledButton } from '@/ui-component/button/StyledButton'
import { Link, useLocation } from 'react-router-dom'
import { useSelector } from 'react-redux'

// ==============================|| UnauthorizedPage ||============================== //

const UnauthorizedPage = () => {
    const currentUser = useSelector((state) => state.auth.user)
    const location = useLocation()
    const state = location.state || {}

    const getFriendlyMessage = () => {
        switch (state.reason) {
            case 'enterprise_only_feature':
                return '该功能仅支持企业版（Enterprise），社区版暂不支持。'
            case 'missing_permission':
                return `当前账号缺少访问权限${state.requiredPermission ? `（需要权限: ${state.requiredPermission}）` : ''}。`
            case 'feature_not_available':
                return `当前组织未开通该功能${state.requiredFeature ? `（功能标识: ${state.requiredFeature}）` : ''}。`
            case 'owner_required':
                return '该页面仅组织 Owner 可访问。'
            case 'no_permissions_assigned':
                return '当前账号尚未分配任何权限，请联系组织管理员。'
            default:
                return 'You do not have permission to access this page.'
        }
    }

    const friendlyMessage = getFriendlyMessage()

    return (
        <>
            <MainCard>
                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        height: 'calc(100vh - 210px)'
                    }}
                >
                    <Stack
                        sx={{
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                        flexDirection='column'
                    >
                        <Box sx={{ p: 2, height: 'auto' }}>
                            <img
                                style={{ objectFit: 'cover', height: '20vh', width: 'auto' }}
                                src={unauthorizedSVG}
                                alt='unauthorizedSVG'
                            />
                        </Box>
                        <Typography sx={{ mb: 2 }} variant='h4' component='div' fontWeight='bold'>
                            403 Forbidden
                        </Typography>
                        <Typography variant='body1' component='div' sx={{ mb: 2 }}>
                            {friendlyMessage}
                        </Typography>
                        {state.path && (
                            <Typography variant='caption' component='div' sx={{ mb: 2 }}>
                                Path: {state.path}
                            </Typography>
                        )}
                        {currentUser ? (
                            <Link to='/'>
                                <StyledButton sx={{ px: 2, py: 1 }}>Back to Home</StyledButton>
                            </Link>
                        ) : (
                            <Link to='/login'>
                                <StyledButton sx={{ px: 2, py: 1 }}>Back to Login</StyledButton>
                            </Link>
                        )}
                    </Stack>
                </Box>
            </MainCard>
        </>
    )
}

export default UnauthorizedPage
