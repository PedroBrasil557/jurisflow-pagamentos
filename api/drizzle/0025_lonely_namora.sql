-- v3 colapso do ownerType para 2 estados: o terceiro estado
-- 'conjuge_titular_contrato_caixa' foi removido. Quem era conjuge-titular
-- passa a ser tratado como o titular do contrato Caixa (mesmas exigencias
-- documentais). Marca origem 'system' pois a reclassificacao e automatica.
UPDATE "process"
SET "owner_type" = 'titular_contrato_caixa',
    "owner_type_source" = 'system'
WHERE "owner_type" = 'conjuge_titular_contrato_caixa';
