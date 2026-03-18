import { useEffect, useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    Stack,
    TextField,
    Typography
} from '@mui/material'

import organizationApi from '@/api/organization'
import { MemoizedReactMarkdown } from '@/ui-component/markdown/MemoizedReactMarkdown'

const formatDateTime = (value) => {
    if (!value) return 'Not published'

    const parsedDate = new Date(value)
    if (Number.isNaN(parsedDate.getTime())) return 'Not published'

    return parsedDate.toLocaleString()
}

const WorldMessageDialog = ({ open, onClose }) => {
    const [loading, setLoading] = useState(false)
    const [submittingAction, setSubmittingAction] = useState('')
    const [draftMessage, setDraftMessage] = useState('')
    const [publishedMessage, setPublishedMessage] = useState('')
    const [publishedAt, setPublishedAt] = useState(null)
    const [error, setError] = useState('')

    const isPublishDisabled = useMemo(() => !draftMessage.trim() || submittingAction !== '', [draftMessage, submittingAction])

    const syncState = (data) => {
        setDraftMessage(data?.draftMessage || '')
        setPublishedMessage(data?.publishedMessage || '')
        setPublishedAt(data?.publishedAt || null)
    }

    useEffect(() => {
        if (!open) return

        let cancelled = false

        const loadWorldMessage = async () => {
            try {
                setLoading(true)
                setError('')
                const response = await organizationApi.getWorldMessageManage()
                if (!cancelled) {
                    syncState(response.data)
                }
            } catch (loadError) {
                if (!cancelled) {
                    setError(loadError?.response?.data?.message || 'Failed to load world message.')
                }
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        loadWorldMessage()

        return () => {
            cancelled = true
        }
    }, [open])

    const runAction = async (action, request) => {
        try {
            setSubmittingAction(action)
            setError('')
            const response = await request()
            syncState(response.data)
        } catch (actionError) {
            setError(actionError?.response?.data?.message || 'Failed to update world message.')
        } finally {
            setSubmittingAction('')
        }
    }

    return (
        <Dialog
            open={open}
            onClose={() => {
                if (submittingAction !== '') return
                onClose()
            }}
            disableEscapeKeyDown={submittingAction !== ''}
            fullWidth
            maxWidth='md'
        >
            <DialogTitle>世界消息</DialogTitle>
            <DialogContent dividers>
                {loading ? (
                    <Stack direction='row' justifyContent='center' sx={{ py: 6 }}>
                        <CircularProgress />
                    </Stack>
                ) : (
                    <Stack sx={{ gap: 3 }}>
                        {error && <Alert severity='error'>{error}</Alert>}
                        <Stack direction='row' alignItems='center' justifyContent='space-between'>
                            <Typography variant='body1'>Published Status</Typography>
                            <Chip
                                color={publishedMessage ? 'success' : 'default'}
                                label={publishedMessage ? 'Published' : 'Not published'}
                            />
                        </Stack>
                        <Typography variant='caption' color='text.secondary'>
                            {publishedMessage ? `Published at ${formatDateTime(publishedAt)}` : 'No published message yet.'}
                        </Typography>
                        <TextField
                            label='Draft Message'
                            multiline
                            minRows={8}
                            value={draftMessage}
                            onChange={(event) => setDraftMessage(event.target.value)}
                            placeholder='Write the world message in Markdown'
                            fullWidth
                        />
                        <Typography variant='caption' color='text.secondary'>
                            Supports Markdown. Raw HTML is not rendered.
                        </Typography>
                        <Box>
                            <Typography variant='subtitle2' sx={{ mb: 1 }}>
                                Draft Preview
                            </Typography>
                            <Box
                                sx={{
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    borderRadius: 2,
                                    minHeight: 180,
                                    p: 2
                                }}
                            >
                                <MemoizedReactMarkdown>{draftMessage || '_No draft yet._'}</MemoizedReactMarkdown>
                            </Box>
                        </Box>
                        <Divider />
                        <Box>
                            <Typography variant='subtitle2' sx={{ mb: 1 }}>
                                Current Published Message
                            </Typography>
                            <Box
                                sx={{
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    borderRadius: 2,
                                    minHeight: 120,
                                    p: 2
                                }}
                            >
                                <MemoizedReactMarkdown>{publishedMessage || '_No published message yet._'}</MemoizedReactMarkdown>
                            </Box>
                        </Box>
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={loading || submittingAction !== ''}>
                    Close
                </Button>
                <Button
                    variant='outlined'
                    onClick={() => runAction('save', () => organizationApi.updateWorldMessageDraft({ draftMessage }))}
                    disabled={loading || submittingAction !== ''}
                >
                    {submittingAction === 'save' ? 'Saving...' : 'Save Draft'}
                </Button>
                <Button
                    color='warning'
                    variant='outlined'
                    onClick={() => runAction('unpublish', () => organizationApi.unpublishWorldMessage())}
                    disabled={loading || submittingAction !== ''}
                >
                    {submittingAction === 'unpublish' ? 'Unpublishing...' : 'Unpublish'}
                </Button>
                <Button
                    variant='contained'
                    onClick={() => runAction('publish', () => organizationApi.publishWorldMessage())}
                    disabled={loading || isPublishDisabled}
                >
                    {submittingAction === 'publish' ? 'Publishing...' : 'Publish'}
                </Button>
            </DialogActions>
        </Dialog>
    )
}

WorldMessageDialog.propTypes = {
    open: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired
}

export default WorldMessageDialog
