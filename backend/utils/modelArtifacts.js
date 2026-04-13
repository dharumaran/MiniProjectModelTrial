const fs = require("fs");
const path = require("path");
const { resolveModelScope } = require("./modelScope");

const ROOT_DIR = path.join(__dirname, "..");
const LEGACY_DEFAULTS = {
  svmSeqPath: path.join(ROOT_DIR, "svm_tier_1_sequence.pkl"),
  svmStatPath: path.join(ROOT_DIR, "svm_tier_2_statistical.pkl"),
  lstmPath: path.join(ROOT_DIR, "ml", "lstm_classifier.pt"),
};

function resolveModelArtifacts(accountNo) {
  const scoped = resolveModelScope(accountNo);
  const shared = resolveModelScope();

  const selectExisting = (candidates) => candidates.find((candidate) => fs.existsSync(candidate));

  const svmSeqPath = selectExisting([
    scoped.svmSeqPath,
    shared.svmSeqPath,
    LEGACY_DEFAULTS.svmSeqPath,
  ]);
  const svmStatPath = selectExisting([
    scoped.svmStatPath,
    shared.svmStatPath,
    LEGACY_DEFAULTS.svmStatPath,
  ]);
  const lstmPath = selectExisting([scoped.lstmPath, shared.lstmPath, LEGACY_DEFAULTS.lstmPath]);

  const missing = [];
  if (!svmSeqPath) {
    missing.push("svm_tier_1_sequence.pkl");
  }
  if (!svmStatPath) {
    missing.push("svm_tier_2_statistical.pkl");
  }
  if (!lstmPath) {
    missing.push("lstm_classifier.pt");
  }

  return {
    scopeId: scoped.scopeId,
    svmSeqPath,
    svmStatPath,
    lstmPath,
    missing,
  };
}

module.exports = {
  resolveModelArtifacts,
  LEGACY_DEFAULTS,
};
