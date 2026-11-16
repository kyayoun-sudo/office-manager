import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createInterface } from 'node:readline'

const [, , env, bump] = process.argv

if (!env || !['staging', 'prod'].includes(env)) {
  console.error('Usage: node scripts/release.mjs <staging|prod> [patch|minor|major]')
  process.exit(1)
}

if (env === 'prod' && !['patch', 'minor', 'major'].includes(bump)) {
  console.error('Production release requires a bump type: patch, minor, or major')
  process.exit(1)
}

const run = (cmd) => execSync(cmd, { encoding: 'utf-8' }).trim()

const branch = run('git rev-parse --abbrev-ref HEAD')

const status = run('git status --porcelain')
if (status) {
  console.error('Le working tree n\'est pas clean. Committez ou stashez vos changements.')
  process.exit(1)
}

const pkgPath = new URL('../package.json', import.meta.url)
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
const currentVersion = pkg.version || '0.0.0'
const [major, minor, patch] = currentVersion.split('.').map(Number)

let newVersion
if (env === 'prod') {
  newVersion =
    bump === 'major' ? `${major + 1}.0.0` :
    bump === 'minor' ? `${major}.${minor + 1}.0` :
    `${major}.${minor}.${patch + 1}`
} else {
  newVersion = currentVersion
}

const tag = `${env}-${newVersion}`

const existingTags = run('git tag --list').split('\n')
if (existingTags.includes(tag)) {
  if (env === 'staging') {
    const timestamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
    const fallbackTag = `${env}-${newVersion}-${timestamp}`
    console.log(`Tag ${tag} existe déjà, utilisation de ${fallbackTag}`)
    await confirmAndRelease(fallbackTag, newVersion, false)
  } else {
    console.error(`Le tag ${tag} existe déjà.`)
    process.exit(1)
  }
} else {
  const bumpVersion = env === 'prod'
  await confirmAndRelease(tag, newVersion, bumpVersion)
}

async function confirmAndRelease(tagName, version, shouldBumpVersion) {
  console.log('')
  console.log(`  Branche       : ${branch}`)
  console.log(`  Environnement : ${env}`)
  if (shouldBumpVersion) console.log(`  Version       : ${currentVersion} → ${version}`)
  console.log(`  Tag           : ${tagName}`)
  console.log('')

  const confirmed = await ask('Confirmer le déploiement ? (y/N) ')
  if (confirmed.toLowerCase() !== 'y') {
    console.log('Annulé.')
    process.exit(0)
  }

  if (shouldBumpVersion) {
    pkg.version = version
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    run('git add package.json')
    run(`git commit -m "release: ${version}"`)
  }

  run(`git tag ${tagName}`)
  run(`git push origin ${branch} --tags`)

  console.log(`\nTag ${tagName} pushé. Le pipeline GitLab CI/CD va démarrer.`)
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}