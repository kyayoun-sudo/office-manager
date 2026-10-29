import { runOfficeManagerKernel, KERNEL_STATUS } from './office-manager-kernel.js';

/**
 * Sika uses the same universal lifecycle as Firm Manager, with Sika's existing
 * orchestrator instructions/tools. No second execution engine is introduced.
 */
export async function runSikaKernel(input, d = {}) {
  return runOfficeManagerKernel({
    ...(input || {}),
    requestedAgent: 'sika'
  }, d);
}

export { KERNEL_STATUS };
