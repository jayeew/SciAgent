import { useEffect, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import { useLocation } from 'react-router-dom'

import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Typography } from '@mui/material'

import organizationApi from '@/api/organization'
import { MemoizedReactMarkdown } from '@/ui-component/markdown/MemoizedReactMarkdown'

const DISMISSED_STORAGE_PREFIX = 'world_message_dismissed'
const PRESENTED_STORAGE_PREFIX = 'world_message_presented'

const parseLoginTimestamp = (loginMarker) => {
    if (!loginMarker) return 0

    const [timestamp] = loginMarker.split(':')
    const parsedTimestamp = Number(timestamp)
    return Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0
}

const buildStorageKey = (prefix, organizationId, publishedAt, loginMarker) => `${prefix}:${organizationId}:${publishedAt}:${loginMarker}`

const formatDateTime = (value) => {
    if (!value) return ''

    const parsedDate = new Date(value)
    if (Number.isNaN(parsedDate.getTime())) return ''

    return parsedDate.toLocaleString()
}

const WorldMessageModal = () => {
    const location = useLocation()
    const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
    const currentUser = useSelector((state) => state.auth.user)
    const loginMarker = useSelector((state) => state.auth.loginMarker)

    const [open, setOpen] = useState(false)
    const [worldMessage, setWorldMessage] = useState(null)

    const organizationId = currentUser?.activeOrganizationId
    const isOwner = currentUser?.isOrganizationAdmin
    const isHomePage = location.pathname === '/'

    const dismissStorageKey = useMemo(() => {
        if (!organizationId || !worldMessage?.publishedAt || !loginMarker) return ''
        return buildStorageKey(DISMISSED_STORAGE_PREFIX, organizationId, worldMessage.publishedAt, loginMarker)
    }, [organizationId, worldMessage?.publishedAt, loginMarker])

    useEffect(() => {
        if (!isAuthenticated || !organizationId || isOwner || !loginMarker) {
            setOpen(false)
            setWorldMessage(null)
            return
        }

        if (!isHomePage) {
            setOpen(false)
            return
        }

        let cancelled = false

        const loadWorldMessage = async () => {
            try {
                const response = await organizationApi.getWorldMessage()
                if (cancelled) return

                const publishedMessage = response.data?.publishedMessage
                const publishedAt = response.data?.publishedAt
                if (!publishedMessage || !publishedAt) {
                    setOpen(false)
                    setWorldMessage(null)
                    return
                }

                const publishedTimestamp = new Date(publishedAt).getTime()
                const loginTimestamp = parseLoginTimestamp(loginMarker)

                setWorldMessage({
                    publishedMessage,
                    publishedAt
                })

                if (!loginTimestamp || Number.isNaN(publishedTimestamp) || publishedTimestamp > loginTimestamp) {
                    setOpen(false)
                    return
                }

                const dismissedKey = buildStorageKey(DISMISSED_STORAGE_PREFIX, organizationId, publishedAt, loginMarker)
                const presentedKey = buildStorageKey(PRESENTED_STORAGE_PREFIX, organizationId, publishedAt, loginMarker)

                if (localStorage.getItem(dismissedKey) || localStorage.getItem(presentedKey)) {
                    setOpen(false)
                    return
                }

                localStorage.setItem(presentedKey, 'true')
                setOpen(true)
            } catch (error) {
                if (!cancelled) {
                    console.error('Failed to load world message', error)
                    setOpen(false)
                    setWorldMessage(null)
                }
            }
        }

        loadWorldMessage()

        return () => {
            cancelled = true
        }
    }, [isAuthenticated, organizationId, isOwner, isHomePage, loginMarker])

    const handleClose = () => {
        if (dismissStorageKey) {
            localStorage.setItem(dismissStorageKey, 'true')
        }
        setOpen(false)
    }

    return (
        <Dialog open={open} onClose={handleClose} fullWidth maxWidth='sm'>
            <DialogTitle>世界消息</DialogTitle>
            <DialogContent dividers>
                <Box
                    sx={{
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 2,
                        p: 2
                    }}
                >
                    <MemoizedReactMarkdown>{worldMessage?.publishedMessage || ''}</MemoizedReactMarkdown>
                </Box>
                {worldMessage?.publishedAt && (
                    <>
                        <Divider sx={{ my: 2 }} />
                        <Typography variant='caption' color='text.secondary'>
                            Published at {formatDateTime(worldMessage.publishedAt)}
                        </Typography>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button variant='contained' onClick={handleClose}>
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export default WorldMessageModal
