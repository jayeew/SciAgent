// TODO: add settings

import { Platform } from '../../Interface'
import { ENABLE_PUBLIC_REGISTRATION } from '../../utils/constants'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'

const getSettings = async () => {
    try {
        const appServer = getRunningExpressApp()
        const platformType = appServer.identityManager.getPlatformType()

        switch (platformType) {
            case Platform.ENTERPRISE: {
                if (!appServer.identityManager.isLicenseValid()) {
                    return {}
                } else {
                    return { PLATFORM_TYPE: Platform.ENTERPRISE, ENABLE_PUBLIC_REGISTRATION }
                }
            }
            case Platform.CLOUD: {
                return { PLATFORM_TYPE: Platform.CLOUD, ENABLE_PUBLIC_REGISTRATION: false }
            }
            default: {
                return { PLATFORM_TYPE: Platform.OPEN_SOURCE, ENABLE_PUBLIC_REGISTRATION }
            }
        }
    } catch (error) {
        return {}
    }
}

export default {
    getSettings
}
