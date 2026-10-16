import { evaluateSimulationScan } from '../lib/firm-simulation-evaluator.js';
import { SimulationDisk } from '../lib/firm-simulation-disk.js';
import { viewFirm } from '../lib/firm-simulation.js';
import { simulationPopulation, populationWorkbook, scanSimulationPopulation } from '../lib/firm-simulation-population.js';

const [command, directory, value, boundary] = process.argv.slice(2);
if (!directory || !['init', 'step', 'pause', 'status', 'population', 'verify'].includes(command)) {
  console.error('Usage: node scripts/firm-lab.mjs init|step|pause|status|population|verify DIRECTORY [actions|year] [until-month]');
  process.exitCode = 1;
} else {
  const disk = new SimulationDisk(directory);
  if (command === 'init') await disk.initialize({ seed: 3, maxActions: Number(value ?? 500) });
  if (command === 'step') await disk.run({ limit: Number(value ?? 1), untilMonth: Number(boundary ?? 24) });
  if (command === 'pause') await disk.run({ pause: true });
  const { campaign, manifest } = await disk.load();
  if (command === 'population') {
    const year = Number(value ?? 2027);
    const population = simulationPopulation({ seed: campaign.seed, year });
    const report = scanSimulationPopulation(population);
    await disk.exclusive(async () => {
      const ledger = await disk.put(await populationWorkbook(population));
      const data = await disk.put(Buffer.from(JSON.stringify(population)));
      const controls = await disk.put(Buffer.from(JSON.stringify(report)));
      console.log(JSON.stringify({ label: 'SIMULATION', year, ledger, data, controls, report, evaluation: evaluateSimulationScan({ seed: campaign.seed, year }, report) }, null, 2));
    });
  } else {
    console.log(JSON.stringify({ label: 'SIMULATION — reference only, no model or production workflow tested', ...viewFirm(campaign).summary, status: campaign.status, month: campaign.month, disk_run: campaign.disk_run, files_verified: manifest.files.length, blocker: campaign.blocker ?? null }, null, 2));
  }
}
