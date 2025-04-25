// This script is used to fetch transaction details from Helius for single transactions IDs

import * as https from 'https';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

async function fetchTransactionDetails() {
    const apiKey = process.env.HELIUS_API_KEY;
    if (!apiKey) {
        console.error('Error: HELIUS_API_KEY not found in .env file.');
        process.exit(1);
    }

    const transactions = [
        '26iRD8WnFN8vu7eASxTb1eKxYmf5JNyL1W3JKDmWBVtM4dpSvvgcpXctfkZFBDSpd5bQTRQUPhvn9VaqJvB16SWn',
        'maYvktgsvkbJBFjqapNqYJYZvKtFUQMd7RWcUqV1pbc2CxyWEhm3ecyQutJ1cFu3jzvV667DtouuX9ejfFaSJe9',
        '2cJLt9UToLubtZZAVnTvrsKUESK1xsHQEpobUvjmRYFYQSGxoUiQ2p6GkEF2m9VkGrASsL8yPfBZJjN3SSsh3UQz',
        '29x7Hzx2W4F85pG89jJPUuqrkZy41oUCDxjiekgiBqF9n8ywvKnpGd2ssBdGtPXeayysyX2MAu6SpZetVvtMbLjg'
    ];

    const postData = JSON.stringify({ transactions });

    const options: https.RequestOptions = {
        hostname: 'api.helius.xyz',
        path: `/v0/transactions/?api-key=${apiKey}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    console.log('Fetching transaction details from Helius...');

    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                try {
                    console.log('\n--- Transaction Details ---');
                    console.log(JSON.stringify(JSON.parse(data), null, 2));
                    console.log('\n--- End Details ---');
                } catch (e) {
                    console.error('Error parsing Helius JSON response:', e);
                    console.log('Raw Response:', data);
                }
            } else {
                 console.error(`Error: Received status code ${res.statusCode} from Helius.`);
                 console.log('Raw Response:', data);
            }
        });
    });

    req.on('error', (e) => {
        console.error(`Problem with request: ${e.message}`);
    });

    // Write data to request body
    req.write(postData);
    req.end();
}

fetchTransactionDetails(); 