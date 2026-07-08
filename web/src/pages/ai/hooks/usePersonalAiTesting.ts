import type { PersonalAiMode, PersonalAiSettings } from '@/state/localAi';
import { testSiteAiProvider, type AiProviderTestProgressStep, type AiStatus } from '@/utils/aiApi';
import { testPersonalAiProvider } from '@/utils/personalAiProvider';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

export type PersonalAiTestStatus = 'idle' | 'testing' | 'success' | 'warning' | 'error';

export type PersonalAiTestState = Record<
  PersonalAiMode,
  {
    status: PersonalAiTestStatus;
  }
>;

export type PersonalAiProbe = {
  ready: boolean;
  label: string;
  detail: string;
};

type UsePersonalAiTestingOptions = {
  status: AiStatus | undefined;
  isStatusLoading: boolean;
  personalAi: PersonalAiSettings;
};

export function usePersonalAiTesting({
  status,
  isStatusLoading,
  personalAi,
}: UsePersonalAiTestingOptions) {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.aiMemory' });
  const [personalAiTestState, setPersonalAiTestState] = useState<PersonalAiTestState>({
    site: { status: 'idle' },
    personal: { status: 'idle' },
  });

  function getModeProbe(mode: PersonalAiMode): PersonalAiProbe {
    if (mode === 'site') {
      const ready = Boolean(status?.available);
      const partial = !ready && Boolean(status?.chatAvailable && status?.chatAllowed);
      return {
        ready,
        label: isStatusLoading
          ? t('personal.probeChecking')
          : ready
            ? t('personal.probeReady')
            : partial
              ? t('personal.probePartial')
              : t('personal.probeMissing'),
        detail: isStatusLoading
          ? t('personal.siteProbeChecking')
          : ready
            ? t('personal.siteProbeReady')
            : partial
              ? t('personal.siteProbePartial')
              : t('personal.siteProbeMissing'),
      };
    }

    const config = personalAi.personal;
    const configured = Boolean(config.baseUrl.trim()) && Boolean(config.model.trim());
    return {
      ready: configured,
      label: configured
        ? config.enabled
          ? t('personal.probeReady')
          : t('personal.probeConfigured')
        : t('personal.probeMissing'),
      detail: configured
        ? config.enabled
          ? t('personal.personalProbeReady')
          : t('personal.personalProbeDisabled')
        : t('personal.personalProbeMissing'),
    };
  }

  function getTranslatedProviderMessage(value: unknown) {
    if (typeof value !== 'string') return '';
    if (value === 'personal_ai_cors_blocked') return t('personal.errors.corsBlocked');
    if (value === 'personal_ai_proxy_intercepted') return t('personal.errors.proxyIntercepted');
    if (value === 'personal_ai_request_failed') return t('personal.errors.requestFailed');
    if (value === 'personal_ai_invalid_response') return t('personal.errors.invalidResponse');
    if (value === 'tool_calling_no_call') return t('personal.toolCallingReasons.noCall');
    if (value === 'tool_calling_invalid_arguments') {
      return t('personal.toolCallingReasons.invalidArguments');
    }
    if (value === 'tool_calling_probe_failed') return t('personal.toolCallingReasons.probeFailed');
    return value;
  }

  function getTestMessage(error: any) {
    const message =
      error?.response?.data?.message || error?.message || error?.response?.data?.error;
    return getTranslatedProviderMessage(message) || t('personal.testFailed');
  }

  function getTestProgressMessage(step: AiProviderTestProgressStep) {
    if (step === 'site') return t('personal.testToastSite');
    if (step === 'personal_remote') return t('personal.testToastRemoteProxy');
    if (step === 'tool_calling') return t('personal.testToastToolCalling');
    return t('personal.testToastLocalChat');
  }

  async function testPersonalAiMode(mode: PersonalAiMode) {
    const probe = getModeProbe(mode);
    if (!probe.ready && mode !== 'site') {
      toast.error(probe.detail);
      setPersonalAiTestState((prev) => ({
        ...prev,
        [mode]: { status: 'error' },
      }));
      return;
    }

    const toastId = toast.loading(t('personal.testToastStarting'));
    const updateTestToast = (step: AiProviderTestProgressStep) => {
      toast.loading(getTestProgressMessage(step), { id: toastId });
    };

    setPersonalAiTestState((prev) => ({
      ...prev,
      [mode]: { status: 'testing' },
    }));

    try {
      const response =
        mode === 'site'
          ? await testSiteAiProvider(updateTestToast)
          : await testPersonalAiProvider(personalAi.personal, updateTestToast);
      const latencyText =
        typeof response.data.latencyMs === 'number'
          ? t('personal.testLatency', { ms: response.data.latencyMs })
          : '';
      const toolCallingSupported = response.data.toolCalling?.supported === true;
      const toolCallingUnsupported = response.data.toolCalling?.supported === false;
      const toolCallingReason =
        getTranslatedProviderMessage(
          response.data.toolCalling?.error || response.data.toolCalling?.message
        ) || t('personal.toolCallingUnknown');
      const message = toolCallingSupported
        ? t('personal.toolCallingSupported')
        : toolCallingUnsupported
          ? t('personal.toolCallingUnsupported', { reason: toolCallingReason })
          : latencyText || response.message || t('personal.testSuccess');
      setPersonalAiTestState((prev) => ({
        ...prev,
        [mode]: { status: toolCallingUnsupported ? 'warning' : 'success' },
      }));
      if (toolCallingUnsupported) {
        toast.warning(message, { id: toastId, duration: 6000 });
      } else {
        toast.success(message, { id: toastId });
      }
    } catch (error: any) {
      const message = getTestMessage(error);
      setPersonalAiTestState((prev) => ({
        ...prev,
        [mode]: { status: 'error' },
      }));
      toast.error(message, { id: toastId, duration: 8000 });
    }
  }

  return {
    personalAiTestState,
    getModeProbe,
    testPersonalAiMode,
  };
}
