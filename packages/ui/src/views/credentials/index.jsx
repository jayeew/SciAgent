import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { enqueueSnackbar as enqueueSnackbarAction, closeSnackbar as closeSnackbarAction } from '@/store/actions'
import moment from 'moment'

// material-ui
import { styled } from '@mui/material/styles'
import { tableCellClasses } from '@mui/material/TableCell'
import {
    Alert,
    Autocomplete,
    Button,
    Box,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Skeleton,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    MenuItem,
    TextField,
    Typography,
    useTheme
} from '@mui/material'

// project imports
import MainCard from '@/ui-component/cards/MainCard'
import { PermissionIconButton, StyledPermissionButton } from '@/ui-component/button/RBACButtons'
import CredentialListDialog from './CredentialListDialog'
import ConfirmDialog from '@/ui-component/dialog/ConfirmDialog'
import AddEditCredentialDialog from './AddEditCredentialDialog'
import ViewHeader from '@/layout/MainLayout/ViewHeader'
import ErrorBoundary from '@/ErrorBoundary'

// API
import credentialsApi from '@/api/credentials'

// Hooks
import useApi from '@/hooks/useApi'
import useConfirm from '@/hooks/useConfirm'

// utils
import useNotifier from '@/utils/useNotifier'

// Icons
import { IconTrash, IconEdit, IconX, IconPlus, IconShare, IconDeviceFloppy, IconAdjustments } from '@tabler/icons-react'
import CredentialEmptySVG from '@/assets/images/credential_empty.svg'
import keySVG from '@/assets/images/key.svg'

// const
import { baseURL } from '@/store/constant'
import { SET_COMPONENT_CREDENTIALS } from '@/store/actions'
import { useError } from '@/store/context/ErrorContext'
import ShareWithWorkspaceDialog from '@/ui-component/dialog/ShareWithWorkspaceDialog'

const StyledTableCell = styled(TableCell)(({ theme }) => ({
    borderColor: theme.palette.grey[900] + 25,
    padding: '6px 16px',

    [`&.${tableCellClasses.head}`]: {
        color: theme.palette.grey[900]
    },
    [`&.${tableCellClasses.body}`]: {
        fontSize: 14,
        height: 64
    }
}))

const StyledTableRow = styled(TableRow)(() => ({
    // hide last border
    '&:last-child td, &:last-child th': {
        border: 0
    }
}))

const EMPTY_BILLING_RULE_ROW = {
    model: '',
    billingMode: 'token',
    multiplier: 1,
    inputRmbPerMTok: '',
    outputRmbPerMTok: '',
    rmbPerUnit: '',
    rmbPerSecond: '',
    rmbPer10kChars: ''
}

const BILLING_MODE_OPTIONS = [
    { value: 'token', label: 'Token' },
    { value: 'image_count', label: 'Image Count' },
    { value: 'video_count', label: 'Video Count' },
    { value: 'seconds', label: 'Seconds' },
    { value: 'characters', label: 'Characters' }
]

const BILLING_MODE_LABELS = BILLING_MODE_OPTIONS.reduce((acc, option) => ({ ...acc, [option.value]: option.label }), {})

const createEmptyBillingRuleRow = (billingMode = 'token') => ({
    ...EMPTY_BILLING_RULE_ROW,
    billingMode
})

const convertBillingRuleToRow = (model, rule) => {
    const billingMode = rule?.billingMode || 'token'

    return {
        ...createEmptyBillingRuleRow(billingMode),
        model,
        multiplier: Number.isFinite(Number(rule?.multiplier)) && Number(rule?.multiplier) > 0 ? Number(rule.multiplier) : 1,
        inputRmbPerMTok:
            billingMode === 'token' && Number.isFinite(Number(rule?.inputRmbPerMTok)) && Number(rule?.inputRmbPerMTok) >= 0
                ? Number(rule.inputRmbPerMTok)
                : '',
        outputRmbPerMTok:
            billingMode === 'token' && Number.isFinite(Number(rule?.outputRmbPerMTok)) && Number(rule?.outputRmbPerMTok) >= 0
                ? Number(rule.outputRmbPerMTok)
                : '',
        rmbPerUnit:
            (billingMode === 'image_count' || billingMode === 'video_count') &&
            Number.isFinite(Number(rule?.rmbPerUnit)) &&
            Number(rule?.rmbPerUnit) >= 0
                ? Number(rule.rmbPerUnit)
                : '',
        rmbPerSecond:
            billingMode === 'seconds' && Number.isFinite(Number(rule?.rmbPerSecond)) && Number(rule?.rmbPerSecond) >= 0
                ? Number(rule.rmbPerSecond)
                : '',
        rmbPer10kChars:
            billingMode === 'characters' && Number.isFinite(Number(rule?.rmbPer10kChars)) && Number(rule?.rmbPer10kChars) >= 0
                ? Number(rule.rmbPer10kChars)
                : ''
    }
}

const getLegacyFallbackDescription = (fallback) => {
    if (!fallback) return ''

    const modeLabel = BILLING_MODE_LABELS[fallback.billingMode] || fallback.billingMode
    return `${modeLabel}: ${fallback.sourceField} = ${fallback.unitPrice}`
}

// ==============================|| Credentials ||============================== //

const Credentials = () => {
    const theme = useTheme()
    const customization = useSelector((state) => state.customization)
    const currentUser = useSelector((state) => state.auth.user)
    const dispatch = useDispatch()
    useNotifier()
    const { error, setError } = useError()

    const enqueueSnackbar = (...args) => dispatch(enqueueSnackbarAction(...args))
    const closeSnackbar = (...args) => dispatch(closeSnackbarAction(...args))

    const [isLoading, setLoading] = useState(true)
    const [showCredentialListDialog, setShowCredentialListDialog] = useState(false)
    const [credentialListDialogProps, setCredentialListDialogProps] = useState({})
    const [showSpecificCredentialDialog, setShowSpecificCredentialDialog] = useState(false)
    const [specificCredentialDialogProps, setSpecificCredentialDialogProps] = useState({})
    const [credentials, setCredentials] = useState([])
    const [componentsCredentials, setComponentsCredentials] = useState([])
    const [multiplierEdits, setMultiplierEdits] = useState({})
    const [savingMultiplierId, setSavingMultiplierId] = useState('')
    const [showModelMultipliersDialog, setShowModelMultipliersDialog] = useState(false)
    const [activeModelMultiplierCredential, setActiveModelMultiplierCredential] = useState(null)
    const [modelMultiplierRows, setModelMultiplierRows] = useState([])
    const [availableModelOptions, setAvailableModelOptions] = useState([])
    const [loadingModelOptions, setLoadingModelOptions] = useState(false)
    const [savingModelMultipliers, setSavingModelMultipliers] = useState(false)
    const [loadingBillingRules, setLoadingBillingRules] = useState(false)
    const [legacyBillingFallbacks, setLegacyBillingFallbacks] = useState([])

    const [showShareCredentialDialog, setShowShareCredentialDialog] = useState(false)
    const [shareCredentialDialogProps, setShareCredentialDialogProps] = useState({})

    const { confirm } = useConfirm()

    const getAllCredentialsApi = useApi(credentialsApi.getAllCredentials)
    const getAllComponentsCredentialsApi = useApi(credentialsApi.getAllComponentsCredentials)

    const [search, setSearch] = useState('')
    const onSearchChange = (event) => {
        setSearch(event.target.value)
    }
    function filterCredentials(data) {
        return data.name.toLowerCase().indexOf(search.toLowerCase()) > -1
    }

    const isOwner = !!currentUser?.isOrganizationAdmin

    const listCredential = () => {
        const dialogProp = {
            title: 'Add New Credential',
            componentsCredentials
        }
        setCredentialListDialogProps(dialogProp)
        setShowCredentialListDialog(true)
    }

    const addNew = (credentialComponent) => {
        const dialogProp = {
            type: 'ADD',
            cancelButtonName: 'Cancel',
            confirmButtonName: 'Add',
            credentialComponent
        }
        setSpecificCredentialDialogProps(dialogProp)
        setShowSpecificCredentialDialog(true)
    }

    const edit = (credential) => {
        const dialogProp = {
            type: 'EDIT',
            cancelButtonName: 'Cancel',
            confirmButtonName: 'Save',
            data: credential
        }
        setSpecificCredentialDialogProps(dialogProp)
        setShowSpecificCredentialDialog(true)
    }

    const share = (credential) => {
        const dialogProps = {
            type: 'EDIT',
            cancelButtonName: 'Cancel',
            confirmButtonName: 'Share',
            data: {
                id: credential.id,
                name: credential.name,
                title: 'Share Credential',
                itemType: 'credential'
            }
        }
        setShareCredentialDialogProps(dialogProps)
        setShowShareCredentialDialog(true)
    }

    const deleteCredential = async (credential) => {
        const confirmPayload = {
            title: `Delete`,
            description: `Delete credential ${credential.name}?`,
            confirmButtonName: 'Delete',
            cancelButtonName: 'Cancel'
        }
        const isConfirmed = await confirm(confirmPayload)

        if (isConfirmed) {
            try {
                const deleteResp = await credentialsApi.deleteCredential(credential.id)
                if (deleteResp.data) {
                    enqueueSnackbar({
                        message: 'Credential deleted',
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
                    message: `Failed to delete Credential: ${
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
            }
        }
    }

    const onCredentialSelected = (credentialComponent) => {
        setShowCredentialListDialog(false)
        addNew(credentialComponent)
    }

    const onConfirm = () => {
        setShowCredentialListDialog(false)
        setShowSpecificCredentialDialog(false)
        getAllCredentialsApi.request()
    }

    const onSaveMultiplier = async (credential) => {
        const nextValue = Number(multiplierEdits[credential.id] ?? credential.creditConsumptionMultiplier ?? 1)
        if (Number.isNaN(nextValue) || nextValue <= 0) return

        try {
            setSavingMultiplierId(credential.id)
            await credentialsApi.updateCredentialMultiplier(credential.id, nextValue)
            enqueueSnackbar({
                message: 'Multiplier updated',
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
            getAllCredentialsApi.request()
        } catch (error) {
            enqueueSnackbar({
                message: `Failed to update multiplier: ${
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
            setSavingMultiplierId('')
        }
    }

    const openModelMultipliersDialog = async (credential) => {
        setActiveModelMultiplierCredential(credential)
        setModelMultiplierRows([])
        setLegacyBillingFallbacks([])
        setShowModelMultipliersDialog(true)
        setAvailableModelOptions([])

        try {
            setLoadingBillingRules(true)
            setLoadingModelOptions(true)

            const [credentialResp, modelResp] = await Promise.all([
                credentialsApi.getSpecificCredential(credential.id),
                credentialsApi.getCredentialModels(credential.id)
            ])

            const credentialDetails = credentialResp?.data || credential
            const existingBillingRules = credentialDetails.billingRules || {}
            const rows = Object.entries(existingBillingRules).map(([model, rule]) => convertBillingRuleToRow(model, rule))

            setActiveModelMultiplierCredential(credentialDetails)
            setModelMultiplierRows(rows)
            setLegacyBillingFallbacks(
                Array.isArray(credentialDetails.legacyBillingFallbacks) ? credentialDetails.legacyBillingFallbacks : []
            )

            const options = Array.isArray(modelResp?.data)
                ? modelResp.data.map((item) => (typeof item?.name === 'string' ? item.name.trim() : '')).filter((item) => item)
                : []
            setAvailableModelOptions(Array.from(new Set(options)))
        } catch (error) {
            enqueueSnackbar({
                message: `Failed to load billing rules: ${
                    typeof error.response?.data === 'object' ? error.response.data.message : error.message
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
            setLoadingBillingRules(false)
            setLoadingModelOptions(false)
        }
    }

    const closeModelMultipliersDialog = () => {
        setShowModelMultipliersDialog(false)
        setActiveModelMultiplierCredential(null)
        setModelMultiplierRows([])
        setAvailableModelOptions([])
        setLoadingModelOptions(false)
        setSavingModelMultipliers(false)
        setLoadingBillingRules(false)
        setLegacyBillingFallbacks([])
    }

    const onAddModelMultiplierRow = () => {
        setModelMultiplierRows((prev) => [...prev, createEmptyBillingRuleRow()])
    }

    const onRemoveModelMultiplierRow = (indexToRemove) => {
        setModelMultiplierRows((prev) => prev.filter((_, index) => index !== indexToRemove))
    }

    const onUpdateModelMultiplierRow = (indexToUpdate, partialRow) => {
        setModelMultiplierRows((prev) => prev.map((row, index) => (index === indexToUpdate ? { ...row, ...partialRow } : row)))
    }

    const onSaveModelMultipliers = async () => {
        if (!activeModelMultiplierCredential) return

        const normalizedBillingRules = {}
        const seenModels = new Set()

        for (const row of modelMultiplierRows) {
            const modelName = String(row.model || '').trim()
            const multiplier = Number(row.multiplier)
            const billingMode = row.billingMode || 'token'

            if (!modelName) {
                enqueueSnackbar({
                    message: 'Model name cannot be empty',
                    options: {
                        key: new Date().getTime() + Math.random(),
                        variant: 'error'
                    }
                })
                return
            }

            if (seenModels.has(modelName)) {
                enqueueSnackbar({
                    message: `Duplicate model name: ${modelName}`,
                    options: {
                        key: new Date().getTime() + Math.random(),
                        variant: 'error'
                    }
                })
                return
            }
            seenModels.add(modelName)

            if (!Number.isFinite(multiplier) || multiplier <= 0) {
                enqueueSnackbar({
                    message: `Invalid multiplier for model: ${modelName}`,
                    options: {
                        key: new Date().getTime() + Math.random(),
                        variant: 'error'
                    }
                })
                return
            }

            if (billingMode === 'token') {
                const inputRmbPerMTok = Number(row.inputRmbPerMTok)
                const outputRmbPerMTok = Number(row.outputRmbPerMTok)

                if (!Number.isFinite(inputRmbPerMTok) || inputRmbPerMTok < 0) {
                    enqueueSnackbar({
                        message: `Invalid input RMB/MTok for model: ${modelName}`,
                        options: {
                            key: new Date().getTime() + Math.random(),
                            variant: 'error'
                        }
                    })
                    return
                }

                if (!Number.isFinite(outputRmbPerMTok) || outputRmbPerMTok < 0) {
                    enqueueSnackbar({
                        message: `Invalid output RMB/MTok for model: ${modelName}`,
                        options: {
                            key: new Date().getTime() + Math.random(),
                            variant: 'error'
                        }
                    })
                    return
                }

                normalizedBillingRules[modelName] = {
                    billingMode,
                    multiplier,
                    inputRmbPerMTok,
                    outputRmbPerMTok
                }
                continue
            }

            if (billingMode === 'image_count' || billingMode === 'video_count') {
                const rmbPerUnit = Number(row.rmbPerUnit)
                if (!Number.isFinite(rmbPerUnit) || rmbPerUnit < 0) {
                    enqueueSnackbar({
                        message: `Invalid RMB/unit for model: ${modelName}`,
                        options: {
                            key: new Date().getTime() + Math.random(),
                            variant: 'error'
                        }
                    })
                    return
                }

                normalizedBillingRules[modelName] = {
                    billingMode,
                    multiplier,
                    rmbPerUnit
                }
                continue
            }

            if (billingMode === 'seconds') {
                const rmbPerSecond = Number(row.rmbPerSecond)
                if (!Number.isFinite(rmbPerSecond) || rmbPerSecond < 0) {
                    enqueueSnackbar({
                        message: `Invalid RMB/second for model: ${modelName}`,
                        options: {
                            key: new Date().getTime() + Math.random(),
                            variant: 'error'
                        }
                    })
                    return
                }

                normalizedBillingRules[modelName] = {
                    billingMode,
                    multiplier,
                    rmbPerSecond
                }
                continue
            }

            if (billingMode === 'characters') {
                const rmbPer10kChars = Number(row.rmbPer10kChars)
                if (!Number.isFinite(rmbPer10kChars) || rmbPer10kChars < 0) {
                    enqueueSnackbar({
                        message: `Invalid RMB/10k chars for model: ${modelName}`,
                        options: {
                            key: new Date().getTime() + Math.random(),
                            variant: 'error'
                        }
                    })
                    return
                }

                normalizedBillingRules[modelName] = {
                    billingMode,
                    multiplier,
                    rmbPer10kChars
                }
                continue
            }

            enqueueSnackbar({
                message: `Unsupported billing mode for model: ${modelName}`,
                options: {
                    key: new Date().getTime() + Math.random(),
                    variant: 'error'
                }
            })
            return
        }

        try {
            setSavingModelMultipliers(true)
            await credentialsApi.updateCredentialBillingRules(activeModelMultiplierCredential.id, normalizedBillingRules)
            enqueueSnackbar({
                message: 'Billing rules updated',
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
            closeModelMultipliersDialog()
            getAllCredentialsApi.request()
        } catch (error) {
            enqueueSnackbar({
                message: `Failed to update billing rules: ${
                    typeof error.response?.data === 'object' ? error.response.data.message : error.message
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
            setSavingModelMultipliers(false)
        }
    }

    useEffect(() => {
        getAllCredentialsApi.request()
        getAllComponentsCredentialsApi.request()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        setLoading(getAllCredentialsApi.loading)
    }, [getAllCredentialsApi.loading])

    useEffect(() => {
        if (getAllCredentialsApi.data) {
            setCredentials(getAllCredentialsApi.data)
            const nextEdits = {}
            getAllCredentialsApi.data.forEach((item) => {
                nextEdits[item.id] = item.creditConsumptionMultiplier ?? 1
            })
            setMultiplierEdits(nextEdits)
        }
    }, [getAllCredentialsApi.data])

    useEffect(() => {
        if (getAllComponentsCredentialsApi.data) {
            setComponentsCredentials(getAllComponentsCredentialsApi.data)
            dispatch({ type: SET_COMPONENT_CREDENTIALS, componentsCredentials: getAllComponentsCredentialsApi.data })
        }
    }, [getAllComponentsCredentialsApi.data, dispatch])

    return (
        <>
            <MainCard>
                {error ? (
                    <ErrorBoundary error={error} />
                ) : (
                    <Stack flexDirection='column' sx={{ gap: 3 }}>
                        <ViewHeader
                            onSearchChange={onSearchChange}
                            search={true}
                            searchPlaceholder='Search Credentials'
                            title='Credentials'
                            description='API keys, tokens, and secrets for 3rd party integrations'
                        >
                            <StyledPermissionButton
                                permissionId='credentials:create'
                                variant='contained'
                                sx={{ borderRadius: 2, height: '100%' }}
                                onClick={listCredential}
                                startIcon={<IconPlus />}
                            >
                                Add Credential
                            </StyledPermissionButton>
                        </ViewHeader>
                        {!isLoading && credentials.length <= 0 ? (
                            <Stack sx={{ alignItems: 'center', justifyContent: 'center' }} flexDirection='column'>
                                <Box sx={{ p: 2, height: 'auto' }}>
                                    <img
                                        style={{ objectFit: 'cover', height: '16vh', width: 'auto' }}
                                        src={CredentialEmptySVG}
                                        alt='CredentialEmptySVG'
                                    />
                                </Box>
                                <div>No Credentials Yet</div>
                            </Stack>
                        ) : (
                            <TableContainer
                                sx={{ border: 1, borderColor: theme.palette.grey[900] + 25, borderRadius: 2 }}
                                component={Paper}
                            >
                                <Table sx={{ minWidth: 650 }} aria-label='simple table'>
                                    <TableHead
                                        sx={{
                                            backgroundColor: customization.isDarkMode
                                                ? theme.palette.common.black
                                                : theme.palette.grey[100],
                                            height: 56
                                        }}
                                    >
                                        <TableRow>
                                            <StyledTableCell>Name</StyledTableCell>
                                            <StyledTableCell>Last Updated</StyledTableCell>
                                            <StyledTableCell>Created</StyledTableCell>
                                            {isOwner && <StyledTableCell>Multiplier</StyledTableCell>}
                                            {isOwner && <StyledTableCell>Billing Rules</StyledTableCell>}
                                            <StyledTableCell style={{ width: '5%' }}> </StyledTableCell>
                                            <StyledTableCell style={{ width: '5%' }}> </StyledTableCell>
                                            <StyledTableCell style={{ width: '5%' }}> </StyledTableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {isLoading ? (
                                            <>
                                                <StyledTableRow>
                                                    <StyledTableCell>
                                                        <Skeleton variant='text' />
                                                    </StyledTableCell>
                                                    {isOwner && (
                                                        <StyledTableCell>
                                                            <Skeleton variant='text' />
                                                        </StyledTableCell>
                                                    )}
                                                    <StyledTableCell>
                                                        <Skeleton variant='text' />
                                                    </StyledTableCell>
                                                    <StyledTableCell>
                                                        <Skeleton variant='text' />
                                                    </StyledTableCell>
                                                    <StyledTableCell>
                                                        <Skeleton variant='text' />
                                                    </StyledTableCell>
                                                    {isOwner && (
                                                        <StyledTableCell>
                                                            <Skeleton variant='text' />
                                                        </StyledTableCell>
                                                    )}
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
                                                    <StyledTableCell>
                                                        <Skeleton variant='text' />
                                                    </StyledTableCell>
                                                </StyledTableRow>
                                            </>
                                        ) : (
                                            <>
                                                {credentials.filter(filterCredentials).map((credential, index) => (
                                                    <StyledTableRow key={index} sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                                                        <StyledTableCell scope='row'>
                                                            <Box
                                                                sx={{
                                                                    display: 'flex',
                                                                    flexDirection: 'row',
                                                                    alignItems: 'center',
                                                                    gap: 1
                                                                }}
                                                            >
                                                                <Box
                                                                    sx={{
                                                                        width: 35,
                                                                        height: 35,
                                                                        borderRadius: '50%',
                                                                        backgroundColor: customization.isDarkMode
                                                                            ? theme.palette.common.white
                                                                            : theme.palette.grey[300] + 75
                                                                    }}
                                                                >
                                                                    <img
                                                                        style={{
                                                                            width: '100%',
                                                                            height: '100%',
                                                                            padding: 5,
                                                                            objectFit: 'contain'
                                                                        }}
                                                                        alt={credential.credentialName}
                                                                        src={`${baseURL}/api/v1/components-credentials-icon/${credential.credentialName}`}
                                                                        onError={(e) => {
                                                                            e.target.onerror = null
                                                                            e.target.style.padding = '5px'
                                                                            e.target.src = keySVG
                                                                        }}
                                                                    />
                                                                </Box>
                                                                {credential.name}
                                                            </Box>
                                                        </StyledTableCell>
                                                        <StyledTableCell>
                                                            {moment(credential.updatedDate).format('MMMM Do, YYYY HH:mm:ss')}
                                                        </StyledTableCell>
                                                        <StyledTableCell>
                                                            {moment(credential.createdDate).format('MMMM Do, YYYY HH:mm:ss')}
                                                        </StyledTableCell>
                                                        {isOwner && (
                                                            <StyledTableCell>
                                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                                    <TextField
                                                                        size='small'
                                                                        type='number'
                                                                        value={multiplierEdits[credential.id] ?? 1}
                                                                        onChange={(e) => {
                                                                            const value = Number(e.target.value)
                                                                            setMultiplierEdits((prev) => ({
                                                                                ...prev,
                                                                                [credential.id]: Number.isNaN(value) ? '' : value
                                                                            }))
                                                                        }}
                                                                        onKeyDown={(e) => {
                                                                            if (e.key === '-') {
                                                                                e.preventDefault()
                                                                            }
                                                                        }}
                                                                        inputProps={{ min: 0.000001, step: '0.1' }}
                                                                        sx={{ width: 100 }}
                                                                    />
                                                                    <Button
                                                                        variant='outlined'
                                                                        size='small'
                                                                        disabled={savingMultiplierId === credential.id || credential.shared}
                                                                        onClick={() => onSaveMultiplier(credential)}
                                                                    >
                                                                        {savingMultiplierId === credential.id ? (
                                                                            <CircularProgress size={14} />
                                                                        ) : (
                                                                            <IconDeviceFloppy size={14} />
                                                                        )}
                                                                    </Button>
                                                                </Box>
                                                            </StyledTableCell>
                                                        )}
                                                        {isOwner && (
                                                            <StyledTableCell>
                                                                <Button
                                                                    variant='outlined'
                                                                    size='small'
                                                                    disabled={credential.shared}
                                                                    onClick={() => openModelMultipliersDialog(credential)}
                                                                    startIcon={<IconAdjustments size={14} />}
                                                                >
                                                                    Edit Rules
                                                                </Button>
                                                            </StyledTableCell>
                                                        )}
                                                        {!credential.shared && (
                                                            <>
                                                                <StyledTableCell>
                                                                    <PermissionIconButton
                                                                        permissionId={'credentials:share'}
                                                                        display={'feat:workspaces'}
                                                                        title='Share'
                                                                        color='primary'
                                                                        onClick={() => share(credential)}
                                                                    >
                                                                        <IconShare />
                                                                    </PermissionIconButton>
                                                                </StyledTableCell>
                                                                <StyledTableCell>
                                                                    <PermissionIconButton
                                                                        permissionId={'credentials:create,credentials:update'}
                                                                        title='Edit'
                                                                        color='primary'
                                                                        onClick={() => edit(credential)}
                                                                    >
                                                                        <IconEdit />
                                                                    </PermissionIconButton>
                                                                </StyledTableCell>
                                                                <StyledTableCell>
                                                                    <PermissionIconButton
                                                                        permissionId={'credentials:delete'}
                                                                        title='Delete'
                                                                        color='error'
                                                                        onClick={() => deleteCredential(credential)}
                                                                    >
                                                                        <IconTrash />
                                                                    </PermissionIconButton>
                                                                </StyledTableCell>
                                                            </>
                                                        )}
                                                        {credential.shared && (
                                                            <>
                                                                <StyledTableCell colSpan={'3'}>Shared Credential</StyledTableCell>
                                                            </>
                                                        )}
                                                    </StyledTableRow>
                                                ))}
                                            </>
                                        )}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </Stack>
                )}
            </MainCard>
            <CredentialListDialog
                show={showCredentialListDialog}
                dialogProps={credentialListDialogProps}
                onCancel={() => setShowCredentialListDialog(false)}
                onCredentialSelected={onCredentialSelected}
            ></CredentialListDialog>
            {showSpecificCredentialDialog && (
                <AddEditCredentialDialog
                    show={showSpecificCredentialDialog}
                    dialogProps={specificCredentialDialogProps}
                    onCancel={() => setShowSpecificCredentialDialog(false)}
                    onConfirm={onConfirm}
                    setError={setError}
                ></AddEditCredentialDialog>
            )}
            {showShareCredentialDialog && (
                <ShareWithWorkspaceDialog
                    show={showShareCredentialDialog}
                    dialogProps={shareCredentialDialogProps}
                    onCancel={() => setShowShareCredentialDialog(false)}
                    setError={setError}
                ></ShareWithWorkspaceDialog>
            )}
            <Dialog
                fullWidth
                maxWidth='md'
                open={showModelMultipliersDialog}
                onClose={closeModelMultipliersDialog}
                sx={{ '& .MuiDialog-paper': { width: 'min(980px, calc(100% - 64px))' } }}
            >
                <DialogTitle>
                    Billing Rules{activeModelMultiplierCredential ? ` - ${activeModelMultiplierCredential.name}` : ''}
                </DialogTitle>
                <DialogContent>
                    <Stack sx={{ mt: 1, gap: 2 }}>
                        <Typography variant='body2' color='text.secondary'>
                            Exact model matching only. Producers report usage, and pricing is controlled here by billing mode and rule
                            price. If no exact rule matches, the request still succeeds but no credit is charged.
                        </Typography>

                        {!!legacyBillingFallbacks.length && (
                            <Alert severity='warning'>
                                Legacy fallback pricing is still active for this credential and has not yet been saved as explicit
                                exact-model rules: {legacyBillingFallbacks.map((item) => getLegacyFallbackDescription(item)).join(' · ')}
                            </Alert>
                        )}

                        {loadingBillingRules && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                                <CircularProgress size={24} />
                            </Box>
                        )}

                        {!loadingBillingRules && !modelMultiplierRows.length && (
                            <Typography variant='body2' color='text.secondary'>
                                No billing rules configured.
                            </Typography>
                        )}

                        {!loadingBillingRules &&
                            modelMultiplierRows.map((row, index) => (
                                <Stack
                                    key={`${row.model}_${index}`}
                                    direction='row'
                                    sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}
                                >
                                    <Autocomplete
                                        freeSolo
                                        sx={{ flex: 1, minWidth: 240 }}
                                        options={availableModelOptions}
                                        loading={loadingModelOptions}
                                        value={row.model}
                                        onChange={(_, value) => {
                                            onUpdateModelMultiplierRow(index, {
                                                model: typeof value === 'string' ? value : value || ''
                                            })
                                        }}
                                        onInputChange={(_, value) => {
                                            onUpdateModelMultiplierRow(index, {
                                                model: value
                                            })
                                        }}
                                        renderInput={(params) => (
                                            <TextField {...params} size='small' label='Model' placeholder='gpt-5-mini' />
                                        )}
                                    />
                                    <TextField
                                        select
                                        size='small'
                                        label='Billing Mode'
                                        value={row.billingMode}
                                        sx={{ width: 180 }}
                                        onChange={(e) => {
                                            const billingMode = e.target.value
                                            onUpdateModelMultiplierRow(index, {
                                                billingMode,
                                                ...(billingMode === 'token'
                                                    ? { rmbPerUnit: '', rmbPerSecond: '', rmbPer10kChars: '' }
                                                    : billingMode === 'image_count' || billingMode === 'video_count'
                                                    ? { inputRmbPerMTok: '', outputRmbPerMTok: '', rmbPerSecond: '', rmbPer10kChars: '' }
                                                    : billingMode === 'seconds'
                                                    ? { inputRmbPerMTok: '', outputRmbPerMTok: '', rmbPerUnit: '', rmbPer10kChars: '' }
                                                    : { inputRmbPerMTok: '', outputRmbPerMTok: '', rmbPerUnit: '', rmbPerSecond: '' })
                                            })
                                        }}
                                    >
                                        {BILLING_MODE_OPTIONS.map((option) => (
                                            <MenuItem key={option.value} value={option.value}>
                                                {option.label}
                                            </MenuItem>
                                        ))}
                                    </TextField>
                                    <TextField
                                        size='small'
                                        type='number'
                                        label='Multiplier'
                                        value={row.multiplier}
                                        inputProps={{ min: 0.000001, step: '0.1' }}
                                        sx={{ width: 160 }}
                                        onKeyDown={(e) => {
                                            if (e.key === '-') {
                                                e.preventDefault()
                                            }
                                        }}
                                        onChange={(e) => {
                                            const value = Number(e.target.value)
                                            onUpdateModelMultiplierRow(index, {
                                                multiplier: Number.isNaN(value) ? '' : value
                                            })
                                        }}
                                    />
                                    {row.billingMode === 'token' && (
                                        <>
                                            <TextField
                                                size='small'
                                                type='number'
                                                label='Input RMB/MTok'
                                                value={row.inputRmbPerMTok}
                                                inputProps={{ min: 0, step: '0.01' }}
                                                sx={{ width: 190 }}
                                                onKeyDown={(e) => {
                                                    if (e.key === '-') {
                                                        e.preventDefault()
                                                    }
                                                }}
                                                onChange={(e) => {
                                                    const value = Number(e.target.value)
                                                    onUpdateModelMultiplierRow(index, {
                                                        inputRmbPerMTok: Number.isNaN(value) ? '' : value
                                                    })
                                                }}
                                            />
                                            <TextField
                                                size='small'
                                                type='number'
                                                label='Output RMB/MTok'
                                                value={row.outputRmbPerMTok}
                                                inputProps={{ min: 0, step: '0.01' }}
                                                sx={{ width: 190 }}
                                                onKeyDown={(e) => {
                                                    if (e.key === '-') {
                                                        e.preventDefault()
                                                    }
                                                }}
                                                onChange={(e) => {
                                                    const value = Number(e.target.value)
                                                    onUpdateModelMultiplierRow(index, {
                                                        outputRmbPerMTok: Number.isNaN(value) ? '' : value
                                                    })
                                                }}
                                            />
                                        </>
                                    )}
                                    {(row.billingMode === 'image_count' || row.billingMode === 'video_count') && (
                                        <TextField
                                            size='small'
                                            type='number'
                                            label='RMB/Unit'
                                            value={row.rmbPerUnit}
                                            inputProps={{ min: 0, step: '0.01' }}
                                            sx={{ width: 190 }}
                                            onKeyDown={(e) => {
                                                if (e.key === '-') {
                                                    e.preventDefault()
                                                }
                                            }}
                                            onChange={(e) => {
                                                const value = Number(e.target.value)
                                                onUpdateModelMultiplierRow(index, {
                                                    rmbPerUnit: Number.isNaN(value) ? '' : value
                                                })
                                            }}
                                        />
                                    )}
                                    {row.billingMode === 'seconds' && (
                                        <TextField
                                            size='small'
                                            type='number'
                                            label='RMB/Second'
                                            value={row.rmbPerSecond}
                                            inputProps={{ min: 0, step: '0.01' }}
                                            sx={{ width: 190 }}
                                            onKeyDown={(e) => {
                                                if (e.key === '-') {
                                                    e.preventDefault()
                                                }
                                            }}
                                            onChange={(e) => {
                                                const value = Number(e.target.value)
                                                onUpdateModelMultiplierRow(index, {
                                                    rmbPerSecond: Number.isNaN(value) ? '' : value
                                                })
                                            }}
                                        />
                                    )}
                                    {row.billingMode === 'characters' && (
                                        <TextField
                                            size='small'
                                            type='number'
                                            label='RMB/10k Chars'
                                            value={row.rmbPer10kChars}
                                            inputProps={{ min: 0, step: '0.01' }}
                                            sx={{ width: 190 }}
                                            onKeyDown={(e) => {
                                                if (e.key === '-') {
                                                    e.preventDefault()
                                                }
                                            }}
                                            onChange={(e) => {
                                                const value = Number(e.target.value)
                                                onUpdateModelMultiplierRow(index, {
                                                    rmbPer10kChars: Number.isNaN(value) ? '' : value
                                                })
                                            }}
                                        />
                                    )}
                                    <Button color='error' onClick={() => onRemoveModelMultiplierRow(index)}>
                                        <IconTrash size={16} />
                                    </Button>
                                </Stack>
                            ))}
                        <Box>
                            <Button variant='outlined' size='small' onClick={onAddModelMultiplierRow} startIcon={<IconPlus size={14} />}>
                                Add Row
                            </Button>
                        </Box>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeModelMultipliersDialog}>Cancel</Button>
                    <Button variant='contained' onClick={onSaveModelMultipliers} disabled={savingModelMultipliers || loadingBillingRules}>
                        {savingModelMultipliers ? <CircularProgress size={18} /> : 'Save'}
                    </Button>
                </DialogActions>
            </Dialog>
            <ConfirmDialog />
        </>
    )
}

export default Credentials
