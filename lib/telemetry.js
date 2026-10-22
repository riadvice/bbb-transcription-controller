'use strict';

const { propagation, trace, ROOT_CONTEXT, SpanKind } = require('@opentelemetry/api');

// Required first so redis and winston get patched before they load.
// It starts only when OTEL_EXPORTER_OTLP_ENDPOINT is set; the OTEL_* variables configure it.
const enabled = !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_SDK_DISABLED !== 'true';

if (enabled) {
  process.env.OTEL_SERVICE_NAME ??= 'bbb-transcription-controller';
  process.env.OTEL_LOGS_EXPORTER ??= 'none';
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { RedisInstrumentation } = require('@opentelemetry/instrumentation-redis');
  const { WinstonInstrumentation } = require('@opentelemetry/instrumentation-winston');
  new NodeSDK({ instrumentations: [new RedisInstrumentation(), new WinstonInstrumentation()] }).start();
}

const USER_ID = /^[a-z]_[a-z0-9]+$/;
const tracer = trace.getTracer('bbb-transcription-controller');

// Starts a span for a received BBB message, continuing the sender's trace; the caller ends it.
const startMessageSpan = (channel, message) => {
  const envelope = message?.envelope;
  if (!enabled || typeof envelope?.name !== 'string') return null;
  const parent = envelope.routing && typeof envelope.routing === 'object'
    ? propagation.extract(ROOT_CONTEXT, envelope.routing)
    : ROOT_CONTEXT;
  const header = message.core?.header || {};
  return tracer.startSpan(`process ${envelope.name}`, {
    kind: SpanKind.CONSUMER,
    attributes: {
      'messaging.system': 'redis',
      'messaging.operation.type': 'process',
      'messaging.destination.name': channel,
      'bbb.message.name': envelope.name,
      'bbb.meeting.id': header.meetingId || undefined,
      'bbb.user.id': USER_ID.test(header.userId) ? header.userId : undefined,
    },
  }, parent);
};

module.exports = { startMessageSpan };
