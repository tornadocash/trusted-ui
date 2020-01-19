require('dotenv').config()
const fs = require('fs').promises
const util = require('util')
const exec = util.promisify(require('child_process').exec)
const { Mutex } = require('async-mutex')
const mutex = new Mutex()
const aws = require('aws-sdk')
const s3 = new aws.S3()
const express = require('express')
const fileUpload = require('express-fileupload')
const app = express()
app.use(fileUpload({}))
app.use(express.static('static'))

const mysql = require('mysql2/promise');
let db;
let currentContributionIndex = 0

async function uploadToS3(response) {
    try {
        await s3.upload({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: `response${currentContributionIndex}`,
            ACL: 'public-read',
            Body: response,
        }).promise()
    } catch (err) {
        console.log(err)
    }
}

async function verifyResponse() {
    const { stdout, stderr } = await exec(
        '../bin/verify_contribution circuit.json old.params new.params',
        {
            cwd: './snark_files/', 
            env: { 'RUST_BACKTRACE': 1}
        }
    )
    console.log(stdout)
    console.error(stderr)
}

async function insertContributionInfo(name, company) {
    const [rows, _] = await db.execute('insert into contributions values(?, ?)', [name, company])
}

app.get('/challenge', async (req, res) => {
    res.sendFile('./snark_files/old.params', { root: __dirname })
})

app.post('/response', async (req, res) => {
    if (!req.files.response) {
        res.status(400).send('Missing response file')
        return
    }

    await mutex.runExclusive(async () => {
        try {
            console.log(`Started processing response ${currentContributionIndex}`)
            await fs.writeFile('./snark_files/new.params', req.files.response.data)
            await verifyResponse()
    //        await uploadToS3(req.files.response.data)
    //        await fs.rename('response', `response${currentContributionIndex}`)

            console.log(`Committing changes for contribution ${currentContributionIndex}`)
            await fs.rename('./snark_files/new.params', './snark_files/old.params')
            currentContributionIndex++;

            console.log('Finished')
            res.send()
        } catch (e) {
            console.log('e', e)
            res.status(503).send(e.toString())
        }
    });
})

async function init() {
    db = await mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || '3306',
        user: process.env.DB_USER || 'root',
        database: process.env.DB_DATABASE || 'phase2',
        password: process.env.DB_PASSWORD,
        connectionLimit: 100
    })
    const [rows, _] = await db.query('select max(id) as max from contributions')
    currentContributionIndex = rows[0].max
    const port = process.env.PORT || 8000
    app.listen(port)
    console.log('Started on port', port)
}

init()


