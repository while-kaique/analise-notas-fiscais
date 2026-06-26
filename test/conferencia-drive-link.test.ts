import { describe, it, expect } from 'vitest';
import { extrairFileIdDrive, ehLinkDrive } from '../src/conferencia/drive/link.js';

const ID = '1AbC_def-GHIjklmnop'; // 19 chars

describe('extrairFileIdDrive', () => {
  it('open?id=', () => {
    expect(extrairFileIdDrive(`https://drive.google.com/open?id=${ID}`)).toBe(ID);
  });
  it('file/d/{id}/view', () => {
    expect(
      extrairFileIdDrive(`https://drive.google.com/file/d/${ID}/view?usp=sharing`),
    ).toBe(ID);
  });
  it('uc?id=', () => {
    expect(
      extrairFileIdDrive(`https://drive.google.com/uc?id=${ID}&export=download`),
    ).toBe(ID);
  });
  it('docs .../d/{id}/edit', () => {
    expect(extrairFileIdDrive(`https://docs.google.com/document/d/${ID}/edit`)).toBe(ID);
  });
  it('forma transformada pelo n8n (open?id= → file/d/)', () => {
    expect(extrairFileIdDrive(`https://drive.google.com/file/d/${ID}`)).toBe(ID);
  });
  it('fileId cru (≥20 chars)', () => {
    expect(extrairFileIdDrive(`${ID}QRs`)).toBe(`${ID}QRs`);
  });
  it('vazio e URL não-Drive → null', () => {
    expect(extrairFileIdDrive('')).toBeNull();
    expect(extrairFileIdDrive('   ')).toBeNull();
    expect(extrairFileIdDrive('https://example.com/nota.pdf')).toBeNull();
  });
});

describe('ehLinkDrive', () => {
  it('true para links do Drive/Docs e fileId cru', () => {
    expect(ehLinkDrive(`https://drive.google.com/open?id=${ID}`)).toBe(true);
    expect(ehLinkDrive(`https://docs.google.com/document/d/${ID}/edit`)).toBe(true);
    expect(ehLinkDrive(`${ID}QRs`)).toBe(true);
  });
  it('false para URL livre — mesmo que tenha /d/ em host não-Google', () => {
    expect(ehLinkDrive('https://example.com/x.pdf')).toBe(false);
    expect(ehLinkDrive(`https://example.com/d/${ID}`)).toBe(false);
  });
});
