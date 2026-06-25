import { describe, it, expect } from 'vitest';
import { extrairCamposDeXml } from '../src/extract/index.js';

// CNPJs/CPF com DV válido (mesmos vetores usados em parsing.test.ts).
const CHAVE = '12345678901234567890123456789012345678901234'; // 44 dígitos

const NFE = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe${CHAVE}" versao="4.00">
      <ide>
        <nNF>12345</nNF>
        <serie>1</serie>
        <dhEmi>2024-03-15T10:30:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>11222333000181</CNPJ>
        <xNome>EMPRESA EXEMPLO LTDA</xNome>
      </emit>
      <dest>
        <CNPJ>12345678000195</CNPJ>
        <xNome>CLIENTE TESTE SA</xNome>
      </dest>
      <total>
        <ICMSTot>
          <vBC>1000.00</vBC>
          <vNF>1234.56</vNF>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
</nfeProc>`;

describe('extrairCamposDeXml', () => {
  it('extrai os campos de uma NF-e (com nfeProc)', () => {
    const campos = extrairCamposDeXml(NFE);
    expect(campos).not.toBeNull();
    expect(campos).toMatchObject({
      cnpjEmitente: '11222333000181',
      razaoSocialEmitente: 'EMPRESA EXEMPLO LTDA',
      documentoDestinatario: '12345678000195',
      dataEmissao: '2024-03-15T10:30:00-03:00',
      valorTotal: '1234.56',
      numero: '12345',
      serie: '1',
      chaveAcesso: `NFe${CHAVE}`,
    });
  });

  it('preserva zeros à esquerda do CNPJ (não vira número)', () => {
    const xml = `<NFe><infNFe><emit><CNPJ>01234567000189</CNPJ></emit>
      <ide><dhEmi>2024-01-02</dhEmi></ide></infNFe></NFe>`;
    const campos = extrairCamposDeXml(xml);
    expect(campos?.cnpjEmitente).toBe('01234567000189');
  });

  it('acha o vNF mesmo sem o aninhamento total/ICMSTot', () => {
    const xml = `<NFe><infNFe><emit><CNPJ>11222333000181</CNPJ></emit>
      <vNF>99.90</vNF></infNFe></NFe>`;
    expect(extrairCamposDeXml(xml)?.valorTotal).toBe('99.90');
  });

  it('devolve null quando o conteúdo não é XML de nota', () => {
    expect(extrairCamposDeXml('isto não é xml')).toBeNull();
    expect(extrairCamposDeXml('<html><body>oi</body></html>')).toBeNull();
  });
});
