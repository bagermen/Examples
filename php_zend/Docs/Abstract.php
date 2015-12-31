<?php

/**
 * Базовый класс генерации отчетов.
 * Может быть использован как контейнер для общих функций между шаблонами
 * Class Model_Docs_Abstract
 */
abstract class Model_Docs_Abstract implements Model_Docs_Interface
{
  protected $template;
  protected $data;
  protected $params;
  protected $db;

  /**
   * @param mixed $params
   */
  protected function setParams($params)
  {
    $this->params = $params;
  }

  /**
   * @return mixed
   */
  protected function getParams()
  {
    return $this->params;
  }

  public function __construct($data)
  {
    $this->setParams($data);

    /**
     * Инициализация БД.
     */
    $db = Zend_Registry::get('db');
    $this->db = $db;
    $this->db->setFetchMode(Zend_Db::FETCH_ASSOC);
  }

  public function setData($data)
  {
    $this->data = $data;
    return $this;
  }

  public function getData()
  {
    return $this->data;
  }

  public function setTemplate($tpl)
  {
    $this->template = $tpl;
    return $this;
  }

  public function getTemplate()
  {
    return $this->template;
  }

  public function prepare() {
    $this->setData($this->initTpl($this->getParams()));
    return $this;
  }

  /**
   * Функция обработки параметров на гененрацию,
   * которая выводит массив данных для обработке в шаблоне
   * @abstract
   * @param array $params - параметры
   * @return array
   */
  abstract protected function initTpl($params);
}