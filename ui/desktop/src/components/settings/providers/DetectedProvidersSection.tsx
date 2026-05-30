import { memo, useEffect, useState } from 'react';
import { client } from '../../../api/client.gen';
import { ProviderDetails } from '../../../api';
import { defineMessages, useIntl } from '../../../i18n';
import CardContainer from './subcomponents/CardContainer';

// Shape returned by GET /config/detected-providers (goose providers::detect).
// Hand-typed because the route is intentionally out of the OpenAPI doc (the
// schema regen is gated behind the local-inference cargo feature).
type DetectedProvider = {
  provider_id: string;
  display_name: string;
  available: boolean;
  source: 'binary' | 'local-server' | 'env-key';
  detail: string;
};

const i18n = defineMessages({
  foundOnMachine: {
    id: 'detectedProviders.foundOnMachine',
    defaultMessage: 'Found on your computer',
  },
  use: {
    id: 'detectedProviders.use',
    defaultMessage: 'Use this',
  },
});

type Matched = { detected: DetectedProvider; provider: ProviderDetails };

const DetectedCard = memo(function DetectedCard({
  detected,
  provider,
  onUse,
}: Matched & { onUse: (p: ProviderDetails) => void }) {
  const intl = useIntl();
  return (
    <CardContainer
      testId={`detected-provider-${detected.provider_id}`}
      onClick={() => onUse(provider)}
      header={null}
      body={
        <div className="flex flex-col items-center justify-center min-h-[200px] text-center px-3">
          <div className="font-medium text-sm">{detected.display_name}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{detected.detail}</div>
          <div className="text-xs text-blue-600 dark:text-blue-400 mt-3 font-medium">
            {intl.formatMessage(i18n.use)}
          </div>
        </div>
      }
      grayedOut={false}
    />
  );
});

/**
 * "Found on your computer" — local AI tools (Claude Code, Cursor, Codex, Ollama,
 * LM Studio, env keys) detected by the engine and offered one-click. Renders
 * nothing until at least one detected provider also exists in the picker's
 * provider list, so every card launches through the normal flow. The default
 * AgentFlow `flow` card stays untouched below.
 */
function DetectedProvidersSection({
  providers,
  onUse,
}: {
  providers: ProviderDetails[];
  onUse: (provider: ProviderDetails) => void;
}) {
  const intl = useIntl();
  const [detected, setDetected] = useState<DetectedProvider[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await client.get({ url: '/config/detected-providers' });
        if (!cancelled && Array.isArray(res.data)) {
          setDetected(res.data as DetectedProvider[]);
        }
      } catch {
        // Detection is best-effort; a failure just hides the section.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const list = Array.isArray(providers) ? providers : [];
  const matched: Matched[] = detected
    .map((d) => ({ detected: d, provider: list.find((p) => p.name === d.provider_id) }))
    .filter((m): m is Matched => !!m.provider);

  if (matched.length === 0) {
    return null;
  }

  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium text-textStandard mb-2 px-1">
        {intl.formatMessage(i18n.foundOnMachine)}
      </h3>
      <div
        className="grid gap-4 [&_*]:z-20 p-1"
        style={{
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 200px))',
          justifyContent: 'center',
        }}
      >
        {matched.map(({ detected: d, provider }) => (
          <DetectedCard key={d.provider_id} detected={d} provider={provider} onUse={onUse} />
        ))}
      </div>
    </div>
  );
}

export default memo(DetectedProvidersSection);
