import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import moment from 'moment'
import * as PropTypes from 'prop-types'

// material-ui
import {
    Button,
    Box,
    Skeleton,
    Stack,
    Table,
    TableBody,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    useTheme,
    Chip,
    Drawer,
    Typography,
    CircularProgress,
    TextField
} from '@mui/material'

// project imports
import MainCard from '@/ui-component/cards/MainCard'
import ConfirmDialog from '@/ui-component/dialog/ConfirmDialog'
import ViewHeader from '@/layout/MainLayout/ViewHeader'
import ErrorBoundary from '@/ErrorBoundary'
import EditUserDialog from '@/views/users/EditUserDialog'
import { StyledTableCell, StyledTableRow } from '@/ui-component/table/TableStyles'
import InviteUsersDialog from '@/ui-component/dialog/InviteUsersDialog'
import { PermissionIconButton, StyledPermissionButton } from '@/ui-component/button/RBACButtons'

// API
import userApi from '@/api/user'

// Hooks
import useApi from '@/hooks/useApi'
import useConfirm from '@/hooks/useConfirm'

// utils
import useNotifier from '@/utils/useNotifier'

// Icons
import { IconTrash, IconEdit, IconX, IconPlus, IconUser, IconEyeOff, IconEye, IconUserStar } from '@tabler/icons-react'
import users_emptySVG from '@/assets/images/users_empty.svg'

// store
import { useError } from '@/store/context/ErrorContext'
import { enqueueSnackbar as enqueueSnackbarAction, closeSnackbar as closeSnackbarAction } from '@/store/actions'

const TOKEN_STAT_FIELDS = [
    { key: 'totalTokens', label: 'Total Tokens' },
    { key: 'inputTokens', label: 'Input Tokens' },
    { key: 'outputTokens', label: 'Output Tokens' },
    { key: 'cacheReadTokens', label: 'Cache Read Tokens' },
    { key: 'cacheWriteTokens', label: 'Cache Write Tokens' },
    { key: 'reasoningTokens', label: 'Reasoning Tokens' },
    { key: 'acceptedPredictionTokens', label: 'Accepted Prediction Tokens' },
    { key: 'rejectedPredictionTokens', label: 'Rejected Prediction Tokens' },
    { key: 'audioInputTokens', label: 'Audio Input Tokens' },
    { key: 'audioOutputTokens', label: 'Audio Output Tokens' }
]

const toInputDateTimeValue = (value) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    return localDate.toISOString().slice(0, 16)
}

const toIsoDate = (value) => {
    if (!value) return undefined
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return undefined
    return date.toISOString()
}

function ShowUserRow(props) {
    const customization = useSelector((state) => state.customization)

    const [open, setOpen] = useState(false)
    const [userRoles, setUserRoles] = useState([])

    const theme = useTheme()

    const getWorkspacesByUserId = useApi(userApi.getWorkspacesByOrganizationIdUserId)

    const handleViewUserRoles = (userId, organizationId) => {
        setOpen(!open)
        getWorkspacesByUserId.request(organizationId, userId)
    }

    useEffect(() => {
        if (getWorkspacesByUserId.data) {
            setUserRoles(getWorkspacesByUserId.data)
        }
    }, [getWorkspacesByUserId.data])

    useEffect(() => {
        if (!open) {
            setOpen(false)
            setUserRoles([])
        }
    }, [open])

    const currentUser = useSelector((state) => state.auth.user)
    const tokenUsage = props.tokenUsage || {}
    const handleOpenTokenUsageDetails = () => props.onViewTokenUsageClick?.(props.row)

    return (
        <React.Fragment>
            <StyledTableRow
                hover
                onClick={handleOpenTokenUsageDetails}
                sx={{ '&:last-child td, &:last-child th': { border: 0 }, cursor: 'pointer' }}
            >
                <StyledTableCell component='th' scope='row'>
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'row',
                            alignItems: 'center'
                        }}
                    >
                        <div
                            style={{
                                width: 25,
                                height: 25,
                                marginRight: 10,
                                borderRadius: '50%'
                            }}
                        >
                            {props?.row?.isOrgOwner ? (
                                <IconUserStar
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        borderRadius: '50%',
                                        objectFit: 'contain'
                                    }}
                                />
                            ) : (
                                <IconUser
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        borderRadius: '50%',
                                        objectFit: 'contain'
                                    }}
                                />
                            )}
                        </div>
                    </div>
                </StyledTableCell>
                <StyledTableCell>
                    {props.row.user.name ?? ''}
                    {props.row.user.email && (
                        <>
                            <br />
                            {props.row.user.email}
                        </>
                    )}

                    {props.row.isOrgOwner && (
                        <>
                            {' '}
                            <br />
                            <Chip size='small' label={'ORGANIZATION OWNER'} />{' '}
                        </>
                    )}
                </StyledTableCell>
                <StyledTableCell sx={{ textAlign: 'center' }}>
                    {props.row.roleCount}
                    <PermissionIconButton
                        permissionId={'users:manage'}
                        aria-label='expand row'
                        size='small'
                        color='inherit'
                        onClick={(event) => {
                            event.stopPropagation()
                            handleViewUserRoles(props.row.userId, props.row.organizationId)
                        }}
                    >
                        {props.row.roleCount > 0 && open ? <IconEyeOff /> : <IconEye />}
                    </PermissionIconButton>
                </StyledTableCell>
                <StyledTableCell>
                    {'ACTIVE' === props.row.status.toUpperCase() && <Chip color={'success'} label={props.row.status.toUpperCase()} />}
                    {'INVITED' === props.row.status.toUpperCase() && <Chip color={'warning'} label={props.row.status.toUpperCase()} />}
                    {'INACTIVE' === props.row.status.toUpperCase() && <Chip color={'error'} label={props.row.status.toUpperCase()} />}
                </StyledTableCell>
                <StyledTableCell>{!props.row.lastLogin ? 'Never' : moment(props.row.lastLogin).format('DD/MM/YYYY HH:mm')}</StyledTableCell>
                <StyledTableCell>{tokenUsage.totalTokens || 0}</StyledTableCell>
                <StyledTableCell>{tokenUsage.inputTokens || 0}</StyledTableCell>
                <StyledTableCell>{tokenUsage.outputTokens || 0}</StyledTableCell>
                <StyledTableCell>{tokenUsage.cacheReadTokens || 0}</StyledTableCell>
                <StyledTableCell>{tokenUsage.cacheWriteTokens || 0}</StyledTableCell>
                <StyledTableCell>
                    {props.row.status.toUpperCase() === 'INVITED' && (
                        <PermissionIconButton
                            permissionId={'workspace:add-user,users:manage'}
                            title='Edit'
                            color='primary'
                            onClick={(event) => {
                                event.stopPropagation()
                                props.onEditClick(props.row)
                            }}
                        >
                            <IconEdit />
                        </PermissionIconButton>
                    )}
                    {!props.row.isOrgOwner &&
                        props.row.userId !== currentUser.id &&
                        (props.deletingUserId === props.row.user.id ? (
                            <CircularProgress size={24} color='error' />
                        ) : (
                            <PermissionIconButton
                                permissionId={'workspace:unlink-user,users:manage'}
                                title='Delete'
                                color='error'
                                onClick={(event) => {
                                    event.stopPropagation()
                                    props.onDeleteClick(props.row.user)
                                }}
                            >
                                <IconTrash />
                            </PermissionIconButton>
                        ))}
                </StyledTableCell>
            </StyledTableRow>
            <Drawer anchor='right' open={open} onClose={() => setOpen(false)} sx={{ minWidth: 320 }}>
                <Box sx={{ p: 4, height: 'auto', width: 650 }}>
                    <Typography sx={{ textAlign: 'left', mb: 2 }} variant='h2'>
                        Assigned Roles
                    </Typography>
                    <TableContainer
                        style={{ display: 'flex', flexDirection: 'row' }}
                        sx={{ border: 1, borderColor: theme.palette.grey[900] + 25, borderRadius: 2 }}
                        component={Paper}
                    >
                        <Table aria-label='assigned roles table'>
                            <TableHead
                                sx={{
                                    backgroundColor: customization.isDarkMode ? theme.palette.common.black : theme.palette.grey[100],
                                    height: 56
                                }}
                            >
                                <TableRow>
                                    <StyledTableCell sx={{ width: '50%' }}>Role</StyledTableCell>
                                    <StyledTableCell sx={{ width: '50%' }}>Workspace</StyledTableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {userRoles.map((item, index) => (
                                    <TableRow key={index}>
                                        <StyledTableCell>{item.role.name}</StyledTableCell>
                                        <StyledTableCell>
                                            {item.workspace.name}
                                            {/* {assignment.active && <Chip color={'secondary'} label={'Active'} />} */}
                                        </StyledTableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Box>
            </Drawer>
        </React.Fragment>
    )
}

ShowUserRow.propTypes = {
    row: PropTypes.any,
    onDeleteClick: PropTypes.func,
    onEditClick: PropTypes.func,
    onViewTokenUsageClick: PropTypes.func,
    deletingUserId: PropTypes.string,
    tokenUsage: PropTypes.any
}

// ==============================|| Users ||============================== //

const Users = () => {
    const theme = useTheme()
    const customization = useSelector((state) => state.customization)
    const dispatch = useDispatch()
    useNotifier()
    const { error, setError } = useError()
    const currentUser = useSelector((state) => state.auth.user)

    const enqueueSnackbar = (...args) => dispatch(enqueueSnackbarAction(...args))
    const closeSnackbar = (...args) => dispatch(closeSnackbarAction(...args))

    const [isLoading, setLoading] = useState(true)
    const [showInviteDialog, setShowInviteDialog] = useState(false)
    const [showEditDialog, setShowEditDialog] = useState(false)
    const [inviteDialogProps, setInviteDialogProps] = useState({})
    const [users, setUsers] = useState([])
    const [search, setSearch] = useState('')
    const [deletingUserId, setDeletingUserId] = useState(null)
    const [tokenUsageSummary, setTokenUsageSummary] = useState({})
    const [openTokenUsageDrawer, setOpenTokenUsageDrawer] = useState(false)
    const [selectedUsageUser, setSelectedUsageUser] = useState(null)
    const [usageStartDate, setUsageStartDate] = useState('')
    const [usageEndDate, setUsageEndDate] = useState('')
    const [usagePage, setUsagePage] = useState(1)
    const [usageLimit] = useState(10)

    const { confirm } = useConfirm()

    const getAllUsersByOrganizationIdApi = useApi(userApi.getAllUsersByOrganizationId)
    const getTokenUsageSummaryApi = useApi(userApi.getTokenUsageSummary)
    const getTokenUsageDetailsApi = useApi(userApi.getTokenUsageDetails)

    const onSearchChange = (event) => {
        setSearch(event.target.value)
    }

    const requestTokenUsageDetails = (userId, page = 1) => {
        getTokenUsageDetailsApi.request(userId, toIsoDate(usageStartDate), toIsoDate(usageEndDate), page, usageLimit)
    }

    const onViewTokenUsageDetails = (user) => {
        setSelectedUsageUser(user)
        setUsagePage(1)
        setOpenTokenUsageDrawer(true)
        requestTokenUsageDetails(user.userId, 1)
    }

    const applyUsageFilters = () => {
        if (!selectedUsageUser?.userId) return
        setUsagePage(1)
        requestTokenUsageDetails(selectedUsageUser.userId, 1)
    }

    const resetUsageFilters = () => {
        if (!selectedUsageUser?.userId) return
        setUsageStartDate('')
        setUsageEndDate('')
        setUsagePage(1)
        getTokenUsageDetailsApi.request(selectedUsageUser.userId, undefined, undefined, 1, usageLimit)
    }

    const handleUsagePageChange = (nextPage) => {
        if (!selectedUsageUser?.userId) return
        setUsagePage(nextPage)
        requestTokenUsageDetails(selectedUsageUser.userId, nextPage)
    }

    const closeTokenUsageDrawer = () => {
        setOpenTokenUsageDrawer(false)
    }

    function filterUsers(data) {
        return (
            data.user.name?.toLowerCase().indexOf(search.toLowerCase()) > -1 ||
            data.user.email.toLowerCase().indexOf(search.toLowerCase()) > -1
        )
    }

    const addNew = () => {
        const dialogProp = {
            type: 'ADD',
            cancelButtonName: 'Cancel',
            confirmButtonName: 'Send Invite',
            data: null
        }
        setInviteDialogProps(dialogProp)
        setShowInviteDialog(true)
    }

    const edit = (user) => {
        if (user.status.toUpperCase() === 'INVITED') {
            editInvite(user)
        } else {
            editUser(user)
        }
    }

    const editInvite = (user) => {
        const dialogProp = {
            type: 'EDIT',
            cancelButtonName: 'Cancel',
            confirmButtonName: 'Update Invite',
            data: user
        }
        setInviteDialogProps(dialogProp)
        setShowInviteDialog(true)
    }

    const editUser = (user) => {
        const dialogProp = {
            type: 'EDIT',
            cancelButtonName: 'Cancel',
            confirmButtonName: 'Save',
            data: user
        }
        setInviteDialogProps(dialogProp)
        setShowEditDialog(true)
    }

    const deleteUser = async (user) => {
        const confirmPayload = {
            title: `Delete`,
            description: `Remove ${user.name ?? user.email} from organization?`,
            confirmButtonName: 'Delete',
            cancelButtonName: 'Cancel'
        }
        const isConfirmed = await confirm(confirmPayload)

        if (isConfirmed) {
            try {
                setDeletingUserId(user.id)
                const deleteResp = await userApi.deleteOrganizationUser(currentUser.activeOrganizationId, user.id)
                if (deleteResp.data) {
                    enqueueSnackbar({
                        message: 'User removed from organization successfully',
                        options: {
                            key: new Date().getTime() + Math.random(),
                            variant: 'success',
                            action: (key) => (
                                <Button style={{ color: 'white' }} onClick={() => closeSnackbar(key)}>
                                    <IconX />
                                </Button>
                            )
                        }
                    })
                    onConfirm()
                }
            } catch (error) {
                enqueueSnackbar({
                    message: `Failed to delete User: ${
                        typeof error.response.data === 'object' ? error.response.data.message : error.response.data
                    }`,
                    options: {
                        key: new Date().getTime() + Math.random(),
                        variant: 'error',
                        persist: true,
                        action: (key) => (
                            <Button style={{ color: 'white' }} onClick={() => closeSnackbar(key)}>
                                <IconX />
                            </Button>
                        )
                    }
                })
            } finally {
                setDeletingUserId(null)
            }
        }
    }

    const onConfirm = () => {
        setShowInviteDialog(false)
        setShowEditDialog(false)
        getAllUsersByOrganizationIdApi.request(currentUser.activeOrganizationId)
        getTokenUsageSummaryApi.request()
    }

    useEffect(() => {
        getAllUsersByOrganizationIdApi.request(currentUser.activeOrganizationId)
        getTokenUsageSummaryApi.request()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        const interval = setInterval(() => {
            getTokenUsageSummaryApi.request()
        }, 30000)

        return () => clearInterval(interval)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        setLoading(getAllUsersByOrganizationIdApi.loading)
    }, [getAllUsersByOrganizationIdApi.loading])

    useEffect(() => {
        if (getAllUsersByOrganizationIdApi.error) {
            setError(getAllUsersByOrganizationIdApi.error)
        }
    }, [getAllUsersByOrganizationIdApi.error, setError])

    useEffect(() => {
        if (getTokenUsageSummaryApi.error) {
            setError(getTokenUsageSummaryApi.error)
        }
    }, [getTokenUsageSummaryApi.error, setError])

    useEffect(() => {
        if (getTokenUsageDetailsApi.error) {
            setError(getTokenUsageDetailsApi.error)
        }
    }, [getTokenUsageDetailsApi.error, setError])

    useEffect(() => {
        if (getAllUsersByOrganizationIdApi.data) {
            const users = getAllUsersByOrganizationIdApi.data || []
            const orgAdmin = users.find((user) => user.isOrgOwner === true)
            if (orgAdmin) {
                users.splice(users.indexOf(orgAdmin), 1)
                users.unshift(orgAdmin)
            }
            setUsers(users)
        }
    }, [getAllUsersByOrganizationIdApi.data])

    useEffect(() => {
        if (getTokenUsageSummaryApi.data?.users) {
            const usageMap = {}
            for (const usage of getTokenUsageSummaryApi.data.users) {
                usageMap[usage.userId] = usage
            }
            setTokenUsageSummary(usageMap)
        }
    }, [getTokenUsageSummaryApi.data])

    const tokenUsageDetails = getTokenUsageDetailsApi.data
    const tokenUsageRecords = tokenUsageDetails?.records || []
    const usagePagination = tokenUsageDetails?.pagination || { page: usagePage, totalPages: 1, total: 0, limit: usageLimit }

    return (
        <>
            <MainCard>
                {error ? (
                    <ErrorBoundary error={error} />
                ) : (
                    <Stack flexDirection='column' sx={{ gap: 3 }}>
                        <ViewHeader onSearchChange={onSearchChange} search={true} searchPlaceholder='Search Users' title='User Management'>
                            <StyledPermissionButton
                                permissionId={'workspace:add-user,users:manage'}
                                variant='contained'
                                sx={{ borderRadius: 2, height: '100%' }}
                                onClick={addNew}
                                startIcon={<IconPlus />}
                                id='btn_createUser'
                            >
                                Invite User
                            </StyledPermissionButton>
                        </ViewHeader>
                        {!isLoading && users.length === 0 ? (
                            <Stack sx={{ alignItems: 'center', justifyContent: 'center' }} flexDirection='column'>
                                <Box sx={{ p: 2, height: 'auto' }}>
                                    <img
                                        style={{ objectFit: 'cover', height: '20vh', width: 'auto' }}
                                        src={users_emptySVG}
                                        alt='users_emptySVG'
                                    />
                                </Box>
                                <div>No Users Yet</div>
                            </Stack>
                        ) : (
                            <>
                                <Stack flexDirection='row'>
                                    <Box sx={{ py: 2, height: 'auto', width: '100%' }}>
                                        <TableContainer
                                            style={{ display: 'flex', flexDirection: 'row' }}
                                            sx={{ border: 1, borderColor: theme.palette.grey[900] + 25, borderRadius: 2 }}
                                            component={Paper}
                                        >
                                            <Table sx={{ minWidth: 650 }} aria-label='users table'>
                                                <TableHead
                                                    sx={{
                                                        backgroundColor: customization.isDarkMode
                                                            ? theme.palette.common.black
                                                            : theme.palette.grey[100],
                                                        height: 56
                                                    }}
                                                >
                                                    <TableRow>
                                                        <StyledTableCell>&nbsp;</StyledTableCell>
                                                        <StyledTableCell>Email/Name</StyledTableCell>
                                                        <StyledTableCell>Assigned Roles</StyledTableCell>
                                                        <StyledTableCell>Status</StyledTableCell>
                                                        <StyledTableCell>Last Login</StyledTableCell>
                                                        <StyledTableCell>Total Tokens</StyledTableCell>
                                                        <StyledTableCell>Input</StyledTableCell>
                                                        <StyledTableCell>Output</StyledTableCell>
                                                        <StyledTableCell>Cache Hit</StyledTableCell>
                                                        <StyledTableCell>Cache Miss</StyledTableCell>
                                                        <StyledTableCell> </StyledTableCell>
                                                    </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {isLoading ? (
                                                        <>
                                                            <StyledTableRow>
                                                                <StyledTableCell>
                                                                    <Skeleton variant='text' />
                                                                </StyledTableCell>
                                                                <StyledTableCell>
                                                                    <Skeleton variant='text' />
                                                                </StyledTableCell>
                                                                <StyledTableCell>
                                                                    <Skeleton variant='text' />
                                                                </StyledTableCell>
                                                                <StyledTableCell>
                                                                    <Skeleton variant='text' />
                                                                </StyledTableCell>
                                                                <StyledTableCell>
                                                                    <Skeleton variant='text' />
                                                                </StyledTableCell>
                                                                <StyledTableCell>
                                                                    <Skeleton variant='text' />
                                                                </StyledTableCell>
                                                            </StyledTableRow>
                                                            <StyledTableRow>
                                                                <StyledTableCell>
                                                                    <Skeleton variant='text' />
                                                                </StyledTableCell>
                                                                <StyledTableCell>
                                                                    <Skeleton variant='text' />
                                                                </StyledTableCell>
                                                                <StyledTableCell>
                                                                    <Skeleton variant='text' />
                                                                </StyledTableCell>
                                                                <StyledTableCell>
                                                                    <Skeleton variant='text' />
                                                                </StyledTableCell>
                                                                <StyledTableCell>
                                                                    <Skeleton variant='text' />
                                                                </StyledTableCell>
                                                            </StyledTableRow>
                                                        </>
                                                    ) : (
                                                        <>
                                                            {users.filter(filterUsers).map((item, index) => (
                                                                <ShowUserRow
                                                                    key={index}
                                                                    row={item}
                                                                    onDeleteClick={deleteUser}
                                                                    onEditClick={edit}
                                                                    onViewTokenUsageClick={onViewTokenUsageDetails}
                                                                    deletingUserId={deletingUserId}
                                                                    tokenUsage={tokenUsageSummary[item.userId]}
                                                                />
                                                            ))}
                                                        </>
                                                    )}
                                                </TableBody>
                                            </Table>
                                        </TableContainer>
                                    </Box>
                                </Stack>
                            </>
                        )}
                    </Stack>
                )}
            </MainCard>
            <Drawer
                anchor='right'
                open={openTokenUsageDrawer}
                onClose={closeTokenUsageDrawer}
                slotProps={{
                    backdrop: {
                        sx: { backgroundColor: 'rgba(0, 0, 0, 0.45)' }
                    }
                }}
            >
                <Box sx={{ p: 3, width: { xs: '100vw', sm: '90vw', md: 1080 }, height: '100%', overflowY: 'auto' }}>
                    <Stack direction='row' alignItems='center' justifyContent='space-between' sx={{ mb: 2 }}>
                        <Box>
                            <Typography variant='h3'>Token Usage Details</Typography>
                            <Typography variant='body2' sx={{ mt: 0.5 }}>
                                {selectedUsageUser?.user?.name || selectedUsageUser?.user?.email || 'User'}
                            </Typography>
                        </Box>
                        <Button color='inherit' onClick={closeTokenUsageDrawer} startIcon={<IconX size={16} />}>
                            Close
                        </Button>
                    </Stack>
                    <Stack direction={{ xs: 'column', md: 'row' }} sx={{ gap: 1.5, mb: 2 }} alignItems={{ md: 'center' }}>
                        <TextField
                            size='small'
                            type='datetime-local'
                            label='Start Date'
                            value={usageStartDate}
                            onChange={(event) => setUsageStartDate(event.target.value)}
                            InputLabelProps={{ shrink: true }}
                        />
                        <TextField
                            size='small'
                            type='datetime-local'
                            label='End Date'
                            value={usageEndDate}
                            onChange={(event) => setUsageEndDate(event.target.value)}
                            InputLabelProps={{ shrink: true }}
                        />
                        <Button variant='contained' onClick={applyUsageFilters} disabled={getTokenUsageDetailsApi.loading}>
                            Apply
                        </Button>
                        <Button variant='outlined' onClick={resetUsageFilters} disabled={getTokenUsageDetailsApi.loading}>
                            Reset
                        </Button>
                    </Stack>
                    {(usageStartDate || usageEndDate) && (
                        <Typography variant='caption' sx={{ display: 'block', mb: 2 }}>
                            Applied Range: {usageStartDate ? toInputDateTimeValue(usageStartDate) : '-'} ~{' '}
                            {usageEndDate ? toInputDateTimeValue(usageEndDate) : '-'}
                        </Typography>
                    )}
                    {getTokenUsageDetailsApi.loading ? (
                        <Stack sx={{ py: 6 }} justifyContent='center' alignItems='center'>
                            <CircularProgress />
                        </Stack>
                    ) : tokenUsageRecords.length === 0 ? (
                        <Typography variant='body1'>No token usage records found for this user.</Typography>
                    ) : (
                        <Stack sx={{ gap: 2 }}>
                            {tokenUsageRecords.map((record) => (
                                <Paper key={record.id} sx={{ p: 2, border: 1, borderColor: theme.palette.grey[900] + 25 }}>
                                    <Stack direction='row' justifyContent='space-between' sx={{ mb: 1 }}>
                                        <Typography variant='h5'>{record.flowName || 'Unknown Flow'}</Typography>
                                        <Typography variant='body2'>
                                            {record.createdDate ? moment(record.createdDate).format('DD/MM/YYYY HH:mm:ss') : '-'}
                                        </Typography>
                                    </Stack>
                                    <Stack direction='row' flexWrap='wrap' sx={{ gap: 2, mb: 2 }}>
                                        <Typography variant='body2'>flowType: {record.flowType || '-'}</Typography>
                                        <Typography variant='body2'>flowId: {record.flowId || '-'}</Typography>
                                        <Typography variant='body2'>flowName: {record.flowName || '-'}</Typography>
                                        <Typography variant='body2'>executionId: {record.executionId || '-'}</Typography>
                                        <Typography variant='body2'>sessionId: {record.sessionId || '-'}</Typography>
                                    </Stack>
                                    <TableContainer component={Paper} sx={{ mb: 2 }}>
                                        <Table size='small'>
                                            <TableHead
                                                sx={{
                                                    backgroundColor: customization.isDarkMode
                                                        ? theme.palette.common.black
                                                        : theme.palette.grey[100]
                                                }}
                                            >
                                                <TableRow>
                                                    {TOKEN_STAT_FIELDS.map((item) => (
                                                        <StyledTableCell key={item.key}>{item.label}</StyledTableCell>
                                                    ))}
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                <TableRow>
                                                    {TOKEN_STAT_FIELDS.map((item) => (
                                                        <StyledTableCell key={item.key}>{record[item.key] || 0}</StyledTableCell>
                                                    ))}
                                                </TableRow>
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                    <Typography variant='subtitle1' sx={{ mb: 1 }}>
                                        Credentials
                                    </Typography>
                                    <TableContainer component={Paper}>
                                        <Table size='small'>
                                            <TableHead
                                                sx={{
                                                    backgroundColor: customization.isDarkMode
                                                        ? theme.palette.common.black
                                                        : theme.palette.grey[100]
                                                }}
                                            >
                                                <TableRow>
                                                    <StyledTableCell>credentialId</StyledTableCell>
                                                    <StyledTableCell>credentialName</StyledTableCell>
                                                    <StyledTableCell>usageCount</StyledTableCell>
                                                    {TOKEN_STAT_FIELDS.map((item) => (
                                                        <StyledTableCell key={item.key}>{item.label}</StyledTableCell>
                                                    ))}
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {record.credentials?.length ? (
                                                    record.credentials.map((credential) => (
                                                        <TableRow key={credential.id}>
                                                            <StyledTableCell>{credential.credentialId || '-'}</StyledTableCell>
                                                            <StyledTableCell>{credential.credentialName || '-'}</StyledTableCell>
                                                            <StyledTableCell>{credential.usageCount || 0}</StyledTableCell>
                                                            {TOKEN_STAT_FIELDS.map((item) => (
                                                                <StyledTableCell key={item.key}>
                                                                    {credential[item.key] || 0}
                                                                </StyledTableCell>
                                                            ))}
                                                        </TableRow>
                                                    ))
                                                ) : (
                                                    <TableRow>
                                                        <StyledTableCell colSpan={13}>No credential usage details.</StyledTableCell>
                                                    </TableRow>
                                                )}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                    <Box sx={{ mt: 2 }}>
                                        <Typography variant='caption' sx={{ display: 'block', whiteSpace: 'pre-wrap' }}>
                                            modelBreakdown: {JSON.stringify(record.modelBreakdown || {})}
                                        </Typography>
                                        <Typography variant='caption' sx={{ display: 'block', whiteSpace: 'pre-wrap' }}>
                                            usageBreakdown: {JSON.stringify(record.usageBreakdown || {})}
                                        </Typography>
                                    </Box>
                                </Paper>
                            ))}
                        </Stack>
                    )}
                    <Stack direction='row' justifyContent='space-between' alignItems='center' sx={{ mt: 2 }}>
                        <Typography variant='body2'>
                            Total Records: {usagePagination.total || 0} | Page {usagePagination.page || 1} /{' '}
                            {usagePagination.totalPages || 1}
                        </Typography>
                        <Stack direction='row' sx={{ gap: 1 }}>
                            <Button
                                variant='outlined'
                                size='small'
                                disabled={(usagePagination.page || 1) <= 1 || getTokenUsageDetailsApi.loading}
                                onClick={() => handleUsagePageChange((usagePagination.page || 1) - 1)}
                            >
                                Previous
                            </Button>
                            <Button
                                variant='outlined'
                                size='small'
                                disabled={
                                    (usagePagination.page || 1) >= (usagePagination.totalPages || 1) || getTokenUsageDetailsApi.loading
                                }
                                onClick={() => handleUsagePageChange((usagePagination.page || 1) + 1)}
                            >
                                Next
                            </Button>
                        </Stack>
                    </Stack>
                </Box>
            </Drawer>
            {showInviteDialog && (
                <InviteUsersDialog
                    show={showInviteDialog}
                    dialogProps={inviteDialogProps}
                    onCancel={() => setShowInviteDialog(false)}
                    onConfirm={onConfirm}
                ></InviteUsersDialog>
            )}
            {showEditDialog && (
                <EditUserDialog
                    show={showEditDialog}
                    dialogProps={inviteDialogProps}
                    onCancel={() => setShowEditDialog(false)}
                    onConfirm={onConfirm}
                    setError={setError}
                ></EditUserDialog>
            )}
            <ConfirmDialog />
        </>
    )
}

export default Users
