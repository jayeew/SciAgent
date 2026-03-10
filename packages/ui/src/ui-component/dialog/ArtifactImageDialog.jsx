import PropTypes from 'prop-types'

import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material'
import { IconDownload } from '@tabler/icons-react'

const getArtifactDownloadName = (artifact) => {
    const fallbackExtension = artifact?.type === 'jpeg' ? 'jpeg' : 'png'
    const fallbackName = `generated-image.${fallbackExtension}`
    const artifactData = artifact?.data

    if (typeof artifactData !== 'string' || !artifactData) return fallbackName

    try {
        const resolvedUrl = new URL(artifactData, window.location.origin)
        const fileName = resolvedUrl.searchParams.get('fileName')
        if (fileName) return decodeURIComponent(fileName)

        const pathSegments = resolvedUrl.pathname.split('/').filter(Boolean)
        if (pathSegments.length > 0) {
            return decodeURIComponent(pathSegments[pathSegments.length - 1])
        }
    } catch {
        return fallbackName
    }

    return fallbackName
}

const downloadArtifactImage = (artifact) => {
    if (!artifact?.data) return

    const link = document.createElement('a')
    link.href = artifact.data
    link.download = getArtifactDownloadName(artifact)
    link.rel = 'noopener noreferrer'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
}

const ArtifactImageDialog = ({ artifact, onClose, open, title = 'Image Preview' }) => {
    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth='lg'>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent
                dividers
                sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor: 'rgba(0, 0, 0, 0.9)',
                    p: 2
                }}
            >
                {artifact?.data && (
                    <Box
                        component='img'
                        src={artifact.data}
                        alt='artifact-preview'
                        sx={{
                            maxWidth: '100%',
                            maxHeight: '75vh',
                            objectFit: 'contain',
                            borderRadius: 1
                        }}
                    />
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={() => downloadArtifactImage(artifact)} startIcon={<IconDownload size={18} />} disabled={!artifact?.data}>
                    Download
                </Button>
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    )
}

ArtifactImageDialog.propTypes = {
    artifact: PropTypes.shape({
        data: PropTypes.string,
        type: PropTypes.string
    }),
    onClose: PropTypes.func.isRequired,
    open: PropTypes.bool.isRequired,
    title: PropTypes.string
}

export default ArtifactImageDialog
