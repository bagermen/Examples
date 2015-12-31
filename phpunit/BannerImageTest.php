<?php
namespace Petrosoft\LoyaltyBundle\Tests\Services\ImageProcessor;

use Petrosoft\LoyaltyBundle\Services\ImageProcessor\BannerImage;
use Petrosoft\CoreBundle\Tests\FunctionalTestCase;
use Petrosoft\LoyaltyBundle\Models\LFSPromotion;
use Petrosoft\LoyaltyBundle\Models\LFSPromotion\Collection as PromoCol;
use Petrosoft\LoyaltyBundle\Models\LFSBanner;
use Gaufrette\Filesystem;

/**
 * @group Beta
 * @group Functional
 * @group Loyalty
 */
class BannerImageTest extends FunctionalTestCase
{
    protected $promotionId;
    protected $files = array();

    protected function setUp()
    {
        parent::setUp();

        $this->promotionId = new \MongoId();
    }
    /**
     * @group Beta
     * @group Functional
     * @group Loyalty
     * @dataProvider getImage
     * @param string $image
     * @param string $dataUrl
     * @return void
     */
    public function testAddPostImage($image, $dataUrl)
    {
        /** @var Filesystem $gaufrete */
        $gaufrete = $this->getContainer()->get('knp_gaufrette.filesystem_map')->get('loyalty_fs');

        /** @var LFSPromotion $promotion */
        $promotion = $this->getContainer()->get('meetz')->model('Loyalty:Models\LFSPromotion');
        $promotion->setData(array(
            '_id' =>  $this->promotionId,
            'promotion' => 123456,
            'title' => 'some title',
            'brief' => 'some brief',
            'description' => 'some desc',
            'image' => 'some_img',
            'is_public' => true,
            'active_from' => new \MongoDate(),
            'active_to' => new \MongoDate(),
        ));
        $promotion->isObjectNew(false);

        $promoCol = $this->getMockBuilder('Petrosoft\LoyaltyBundle\Models\LFSPromotion\Collection')
            ->setMethods(array('findById'))->getMock();
        $promoCol->expects($this->exactly(2))->method('findById')->will($this->returnValue($promotion));

        $banner = $this->getMockBuilder('Petrosoft\LoyaltyBundle\Models\LFSBanner')
            ->setMethods(array('save'))->getMock();
        $banner->expects($this->once())->method('save')->will($this->returnSelf());
        /** @var LFSBanner $banner */
        $banner->setData(array(
            '_id' => new \MongoId(),
            'lfs_promotion' => $this->promotionId,
            'title' => 'some title',
            'brief' => 'some brief',
            'image' => '',
            'thumbImage' => '',
        ));
        $banner->isObjectNew(false);

        $bannerImage = $this->getBannerImageService($gaufrete, $banner, $promoCol);

        $bannerImage->addPostImage($dataUrl);
        $this->assertNotEmpty($banner->getData('image'));
        $this->assertTrue($gaufrete->has($banner->getData('image')));

        /** @var \Gaufrette\File $file */
        $file = $gaufrete->get($banner->getData('image'));
        $content = $file->getContent();
        $gaufrete->delete($banner->getData('image'));

        $this->assertNotEmpty($banner->getData('thumbImage'));
        $this->assertTrue($gaufrete->has($banner->getData('thumbImage')));

        /** @var \Gaufrette\File $fileThumb */
        $fileThumb = $gaufrete->get($banner->getData('thumbImage'));
        $contentThumb = $fileThumb->getContent();
        $gaufrete->delete($banner->getData('thumbImage'));

        $file = tmpfile();
        $this->files[] = $file;

        if (!is_null($contentThumb)) {
            fwrite($file, $contentThumb);
        }
        $metaData = stream_get_meta_data($file);
        $size = getimagesize($metaData['uri']);
        $this->assertLessThanOrEqual($bannerImage->getThumbWidth(), $size[0]);
        $this->assertLessThanOrEqual($bannerImage->getThumbHeight(), $size[1]);

        $this->assertEquals($image, base64_encode($content));
    }

    /**
     * @group Beta
     * @group Functional
     * @group Loyalty
     * @dataProvider getImage
     * @param string $image
     * @param string $dataUrl
     * @return void
     */
    public function testDelImage($image, $dataUrl)
    {
        /** @var Filesystem $gaufrete */
        $gaufrete = $this->getContainer()->get('knp_gaufrette.filesystem_map')->get('loyalty_fs');

        /** @var LFSPromotion $promotion */
        $promotion = $this->getContainer()->get('meetz')->model('Loyalty:Models\LFSPromotion');
        $promotion->setData(array(
            '_id' =>  $this->promotionId,
            'promotion' => 123456,
            'title' => 'some title',
            'brief' => 'some brief',
            'description' => 'some desc',
            'image' => 'some_img',
            'is_public' => true,
            'active_from' => new \MongoDate(),
            'active_to' => new \MongoDate(),
        ));
        $promotion->isObjectNew(false);

        $promoCol = $this->getMockBuilder('Petrosoft\LoyaltyBundle\Models\LFSPromotion\Collection')
            ->setMethods(array('findById'))->getMock();
        $promoCol->expects($this->exactly(2))->method('findById')->will($this->returnValue($promotion));

        $banner = $this->getMockBuilder('Petrosoft\LoyaltyBundle\Models\LFSBanner')
            ->setMethods(array('save'))->getMock();
        $banner->expects($this->exactly(2))->method('save')->will($this->returnSelf());
        /** @var LFSBanner $banner */
        $banner->setData(array(
            '_id' => new \MongoId(),
            'lfs_promotion' => $this->promotionId,
            'title' => 'some title',
            'brief' => 'some brief',
            'image' => '',
            'thumbImage' => '',
        ));
        $banner->isObjectNew(false);

        $bannerImage = $this->getBannerImageService($gaufrete, $banner, $promoCol);

        $bannerImage->addPostImage($dataUrl);
        $image = $banner->getData('image');
        $thumbImage = $banner->getData('thumbImage');

        $bannerImage->delImage();
        $this->assertFalse($gaufrete->has($image));
        $this->assertFalse($gaufrete->has($thumbImage));
        $this->assertEmpty($banner->getData('image'));
        $this->assertEmpty($banner->getData('thumbImage'));
    }
    /**
     * @return array
     */
    public function getImage()
    {
        $image = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEB';
        $image .= 'EQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';
        $image .= 'BAQEBD/wgARCAD0APQDAREAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAgJ/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQAC';
        $image .= 'EAMQAAABlQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        $image .= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        $image .= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1UAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        $image .= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        $image .= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/8QAFBABAAAAAAAAAAAAAAAAAAAAkP/aAAgBAQABBQJwf//EABQRAQ';
        $image .= 'AAAAAAAAAAAAAAAAAAAJD/2gAIAQMBAT8BcH//xAAUEQEAAAAAAAAAAAAAAAAAAACQ/9oACAECAQE/AXB//8QAFBABAAAAAAAAAAAAAAAAAAAAkP';
        $image .= '/aAAgBAQAGPwJwf//EABQQAQAAAAAAAAAAAAAAAAAAAJD/2gAIAQEAAT8hcH//2gAMAwEAAgADAAAAEJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ';
        $image .= 'JJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ';
        $image .= 'JJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ';
        $image .= 'JJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ';
        $image .= 'JJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ//xAAUEQE';
        $image .= 'AAAAAAAAAAAAAAAAAAACQ/9oACAEDAQE/EHB//8QAFBEBAAAAAAAAAAAAAAAAAAAAkP/aAAgBAgEBPxBwf//EABQQAQAAAAAAAAAAAAAAAAAAAJD/2gAIAQEAAT8QcH//2Q==';
        $dataUrl = sprintf('data:image/jpeg;base64,%s', $image);

        return array(
            array($image, $dataUrl),
        );
    }

    protected function tearDown()
    {
        parent::tearDown();
        foreach ($this->files as $file) {
            fclose($file);
        }
    }
    /**
     * Return BannerImage service
     * @param Filesystem $fileSystem
     * @param LFSBanner $banner
     * @param PromoCol $promoCol
     * @return BannerImage
     */
    protected function getBannerImageService(Filesystem $fileSystem, LFSBanner $banner, PromoCol $promoCol)
    {
        $bannerImage = $this->getMockBuilder('Petrosoft\LoyaltyBundle\Services\ImageProcessor\BannerImage')
            ->setConstructorArgs(array($fileSystem))->setMethods(array('getWidth', 'getHeight'))->getMock();

        $bannerImage->expects($this->once())->method('getWidth')->will($this->returnValue(244));
        $bannerImage->expects($this->once())->method('getHeight')->will($this->returnValue(244));
        /** @var BannerImage $bannerImage */
        $bannerImage->setPromotionCol($promoCol);
        $bannerImage->setModel($banner);

        return $bannerImage;
    }
}
