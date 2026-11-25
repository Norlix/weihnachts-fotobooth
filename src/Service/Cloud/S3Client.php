<?php

namespace Photobooth\Service\Cloud;

/**
 * Minimal S3 client with AWS signature version 4 for path style endpoints. It covers what the Photobooth needs for
 * S3 compatible storage like Backblaze B2, Cloudflare R2 or MinIO, without pulling in a large SDK.
 */
final class S3Client
{
    private string $endpoint;

    public function __construct(
        string $endpoint,
        private readonly string $region,
        private readonly string $bucket,
        private readonly string $accessKey,
        private readonly string $secretKey,
        private readonly int $timeoutSeconds = 120
    ) {
        $this->endpoint = rtrim($endpoint, '/');
    }

    public function putFile(string $key, string $path, string $contentType, string $cacheControl): void
    {
        $this->request('PUT', $key, [], $path, null, ['Content-Type: ' . $contentType, 'Cache-Control: ' . $cacheControl]);
    }

    public function putString(string $key, string $body, string $contentType, string $cacheControl): void
    {
        $this->request('PUT', $key, [], null, $body, ['Content-Type: ' . $contentType, 'Cache-Control: ' . $cacheControl]);
    }

    /**
     * Address that lets anyone with the link download a private object until it expires. S3 compatible services allow
     * at most seven days.
     */
    public function presignGet(string $key, int $expiresSeconds): string
    {
        $parts = parse_url($this->endpoint);
        $host = ($parts['host'] ?? '') . (isset($parts['port']) ? ':' . $parts['port'] : '');
        $path = '/' . rawurlencode($this->bucket) . '/' . implode('/', array_map('rawurlencode', explode('/', $key)));
        $timestamp = gmdate('Ymd\THis\Z');
        $date = gmdate('Ymd');
        $scope = "$date/{$this->region}/s3/aws4_request";

        $query = [
            'X-Amz-Algorithm' => 'AWS4-HMAC-SHA256',
            'X-Amz-Credential' => $this->accessKey . '/' . $scope,
            'X-Amz-Date' => $timestamp,
            'X-Amz-Expires' => (string) min(max(60, $expiresSeconds), 604800),
            'X-Amz-SignedHeaders' => 'host',
        ];
        ksort($query);
        $queryString = implode('&', array_map(
            fn (string $name, string $value): string => rawurlencode($name) . '=' . rawurlencode($value),
            array_keys($query),
            array_values($query)
        ));

        $canonicalRequest = implode("\n", ['GET', $path, $queryString, "host:$host\n", 'host', 'UNSIGNED-PAYLOAD']);
        $stringToSign = implode("\n", ['AWS4-HMAC-SHA256', $timestamp, $scope, hash('sha256', $canonicalRequest)]);
        $signingKey = hash_hmac('sha256', 'aws4_request', hash_hmac('sha256', 's3', hash_hmac('sha256', $this->region, hash_hmac('sha256', $date, 'AWS4' . $this->secretKey, true), true), true), true);

        return $this->endpoint . $path . '?' . $queryString . '&X-Amz-Signature=' . hash_hmac('sha256', $stringToSign, $signingKey);
    }

    public function delete(string $key): void
    {
        $this->request('DELETE', $key, [], null, null, []);
    }

    /**
     * @return string[]
     */
    public function listKeys(string $prefix): array
    {
        $keys = [];
        $token = null;
        do {
            $query = ['list-type' => '2', 'prefix' => $prefix];
            if ($token !== null) {
                $query['continuation-token'] = $token;
            }
            $response = $this->request('GET', '', $query, null, null, []);
            $xml = simplexml_load_string($response);
            if ($xml === false) {
                throw new \RuntimeException('S3 list returned an invalid response.');
            }
            foreach ($xml->Contents ?? [] as $content) {
                $keys[] = (string) $content->Key;
            }
            $token = ((string) $xml->IsTruncated) === 'true' ? (string) $xml->NextContinuationToken : null;
        } while ($token !== null);

        return $keys;
    }

    /**
     * @param array<string, string> $query
     * @param string[] $extraHeaders
     */
    private function request(string $method, string $key, array $query, ?string $file, ?string $body, array $extraHeaders): string
    {
        $parts = parse_url($this->endpoint);
        $host = ($parts['host'] ?? '') . (isset($parts['port']) ? ':' . $parts['port'] : '');
        $path = '/' . rawurlencode($this->bucket);
        if ($key !== '') {
            $path .= '/' . implode('/', array_map('rawurlencode', explode('/', $key)));
        }

        ksort($query);
        $queryString = implode('&', array_map(
            fn (string $name, string $value): string => rawurlencode($name) . '=' . rawurlencode($value),
            array_keys($query),
            array_values($query)
        ));

        $payloadHash = $file !== null ? (string) hash_file('sha256', $file) : hash('sha256', $body ?? '');
        $timestamp = gmdate('Ymd\THis\Z');
        $date = gmdate('Ymd');
        $signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
        $canonicalRequest = implode("\n", [
            $method,
            $path,
            $queryString,
            "host:$host\nx-amz-content-sha256:$payloadHash\nx-amz-date:$timestamp\n",
            $signedHeaders,
            $payloadHash,
        ]);
        $scope = "$date/{$this->region}/s3/aws4_request";
        $stringToSign = implode("\n", ['AWS4-HMAC-SHA256', $timestamp, $scope, hash('sha256', $canonicalRequest)]);

        $signingKey = hash_hmac('sha256', 'aws4_request', hash_hmac('sha256', 's3', hash_hmac('sha256', $this->region, hash_hmac('sha256', $date, 'AWS4' . $this->secretKey, true), true), true), true);
        $signature = hash_hmac('sha256', $stringToSign, $signingKey);

        $headers = array_merge($extraHeaders, [
            "x-amz-content-sha256: $payloadHash",
            "x-amz-date: $timestamp",
            "Authorization: AWS4-HMAC-SHA256 Credential={$this->accessKey}/$scope, SignedHeaders=$signedHeaders, Signature=$signature",
            'Expect:',
        ]);

        $curl = curl_init($this->endpoint . $path . ($queryString !== '' ? '?' . $queryString : ''));
        if ($curl === false) {
            throw new \RuntimeException('Cannot initialise curl.');
        }
        $handle = null;
        curl_setopt_array($curl, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
        ]);
        if ($file !== null) {
            $handle = fopen($file, 'rb');
            if ($handle === false) {
                throw new \RuntimeException('Cannot read ' . $file);
            }
            curl_setopt_array($curl, [
                CURLOPT_UPLOAD => true,
                CURLOPT_INFILE => $handle,
                CURLOPT_INFILESIZE => (int) filesize($file),
            ]);
        } elseif ($body !== null) {
            curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
        }

        $response = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $error = curl_error($curl);
        if (is_resource($handle)) {
            fclose($handle);
        }
        curl_close($curl);

        if ($response === false) {
            throw new \RuntimeException("S3 $method request failed: $error");
        }
        if ($status < 200 || $status >= 300) {
            throw new \RuntimeException("S3 $method $key failed with HTTP $status: " . substr((string) $response, 0, 300));
        }

        return (string) $response;
    }
}
